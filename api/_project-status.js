// 客人自助查詢進度：輸入專案編號＋電話（尾 8 位須相符），回傳服務階段及日期。
// 只回傳毛孩名、階段、日期及紀念品出貨狀態；不回傳地址、電話、金額等個人資料。

const RSL = /^RSL-[A-Z0-9]+-[A-Z0-9]+$/;

function phoneKey(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 8 ? digits.slice(-8) : "";
}

function notesContainProject(notes, projectNo) {
  return String(notes || "").split(/[|｜]/).some((part) => {
    const match = part.match(/(?:專案編號|project\s*(?:no\.|number))\s*[：:]\s*(RSL-[A-Z0-9]+-[A-Z0-9]+)/i);
    return match && match[1].toUpperCase() === projectNo;
  });
}

// 香港日期（YYYY-MM-DD）
function hkDate(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? new Date(t + 8 * 3600 * 1000).toISOString().slice(0, 10) : null;
}

// 只接受 Shopify 付款頁（https）
function safePayLink(url) {
  try {
    const u = new URL(String(url || ""));
    return u.protocol === "https:" && /(^|\.)(myshopify\.com|shopify\.com)$/.test(u.hostname) ? u.href : "";
  } catch (e) {
    return "";
  }
}

const LATER = ["scheduled", "pickup", "cremating", "ready", "completed"];


// 查詢進度（由 api/project-lookup.js 以 detail: true 呼叫；Hobby 計劃限 12 個函數，故不另設端點）
async function projectStatus(projectNo, phone, res) {
  const sbUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !serviceKey) return res.status(503).json({ error: "lookup_unavailable" });
  const base = sbUrl.replace(/\/+$/, "") + "/rest/v1/";
  const headers = { apikey: serviceKey, Authorization: "Bearer " + serviceKey };
  const get = (table, params) => fetch(base + table + "?" + new URLSearchParams(params), { headers });

  try {
    const [dRes, bRes, oRes] = await Promise.all([
      get("deposit_bookings", { select: "created_at,status,source,service_date,payment_status,paid_at,pet_name,contact,payment_link", project_no: "eq." + projectNo }),
      get("cremation_bookings", {
        select: "id,created_at,status,source,service_date,payment_status,paid_at,pet_name,contact,case_no,notes,picked_up_at,cremation_started_at,ready_at,returned_at",
        or: "(case_no.eq." + projectNo + ",notes.ilike.*" + projectNo + "*)",
      }),
      get("product_orders", { select: "phone,financial_status,fulfillment_status,cancelled_at,line_items,shopify_created_at", project_no: "eq." + projectNo }),
    ]);
    if (!dRes.ok || !bRes.ok) {
      console.error("[Resoul] project status query failed");
      return res.status(503).json({ error: "lookup_unavailable" });
    }
    const mine = (row, field) => phoneKey(row[field]) === phone;
    const deposits = (await dRes.json()).filter((r) => mine(r, "contact"));
    const bookings = (await bRes.json()).filter((r) => (String(r.case_no || "").toUpperCase() === projectNo || notesContainProject(r.notes, projectNo)) && mine(r, "contact"));
    const orders = oRes.ok ? (await oRes.json()).filter((r) => mine(r, "phone")) : [];
    res.setHeader("Cache-Control", "no-store");
    if (!deposits.length && !bookings.length && !orders.length) return res.status(200).json({ found: false });

    // 未付款預約的付款連結（後台產生的 Shopify 付款頁）：訂金記錄自身欄位，火化預約於 follow_up_marks
    const unpaidBookings = bookings.filter((b) => b.status !== "cancelled" && b.payment_status !== "paid" && !String(b.source || "").includes("euthanasia") && b.id);
    const marks = {};
    if (unpaidBookings.length) {
      const mRes = await get("follow_up_marks", { select: "ref,payment_link", entity: "eq.cremation", ref: "in.(" + unpaidBookings.map((b) => b.id).join(",") + ")" });
      if (mRes.ok) (await mRes.json()).forEach((m) => { marks[m.ref] = m.payment_link; });
    }

    // 分三類：上門安樂死（source 含 euthanasia）、接送及火化、紀念品訂單；同一專案可同時有多類
    const isVet = (r) => String(r.source || "").includes("euthanasia");
    const service = [...deposits, ...bookings];
    const vetRows = service.filter(isVet);
    const cremRows = service.filter((r) => !isVet(r));
    const live = (rows) => rows.filter((r) => r.status !== "cancelled");
    const earliest = (rows, field) => rows.map((r) => r[field]).filter(Boolean).sort()[0] || null;
    const pet = (service.find((r) => r.pet_name) || {}).pet_name || "";
    const sections = [];

    if (vetRows.length) {
      const active = live(vetRows);
      const scheduled = active.filter((r) => LATER.includes(r.status));
      sections.push({
        type: "vet",
        cancelled: !active.length,
        steps: [
          { key: "received_vet", date: hkDate(earliest(vetRows, "created_at")) },
          { key: "vet_scheduled", date: scheduled.length ? hkDate(earliest(scheduled, "service_date")) || "" : null },
          { key: "vet_done", date: active.some((r) => r.status === "completed") ? hkDate(earliest(active.filter((r) => r.status === "completed"), "service_date")) || "" : null },
        ],
      });
    }
    if (cremRows.length) {
      const active = live(cremRows);
      const paid = active.filter((r) => r.payment_status === "paid");
      const scheduled = active.filter((r) => LATER.includes(r.status));
      const unpaid = active.filter((r) => r.payment_status !== "paid");
      const payLink = paid.length ? "" : unpaid.map((r) => safePayLink(r.payment_link || marks[r.id])).find(Boolean) || "";
      const c = active.filter((r) => r.picked_up_at || r.cremation_started_at || r.ready_at || r.returned_at);
      sections.push({
        type: "cremation",
        cancelled: !active.length,
        unpaid: active.length > 0 && !paid.length,
        payLink,
        steps: [
          { key: "received", date: hkDate(earliest(cremRows, "created_at")) },
          { key: "paid", date: paid.length ? hkDate(earliest(paid, "paid_at") || earliest(paid, "created_at")) : null },
          { key: "scheduled", date: scheduled.length ? hkDate(earliest(scheduled, "service_date")) || "" : null },
          { key: "picked_up", date: hkDate(earliest(c, "picked_up_at")) },
          { key: "cremating", date: hkDate(earliest(c, "cremation_started_at")) },
          { key: "ready", date: hkDate(earliest(c, "ready_at")) },
          { key: "returned", date: hkDate(earliest(c, "returned_at")) },
        ],
      });
    }
    orders
      .sort((x, y) => String(x.shopify_created_at || "").localeCompare(String(y.shopify_created_at || "")))
      .forEach((o) => {
        const paid = ["PAID", "PARTIALLY_REFUNDED"].includes(o.financial_status);
        const shipped = o.fulfillment_status === "FULFILLED";
        sections.push({
          type: "keepsake",
          cancelled: !!o.cancelled_at,
          items: (o.line_items || []).map((it) => String(it.title || "") + "×" + (it.quantity || 1)).join("、"),
          steps: [
            { key: "k_ordered", date: hkDate(o.shopify_created_at) },
            { key: "k_paid", date: paid || shipped ? "" : null },
            { key: "k_preparing", date: paid || shipped ? "" : null },
            { key: "k_shipped", date: shipped ? "" : null },
          ],
        });
      });

    return res.status(200).json({ found: true, pet, sections });
  } catch (error) {
    console.error("[Resoul] project status request failed");
    return res.status(503).json({ error: "lookup_unavailable" });
  }
}

module.exports = { projectStatus, phoneKey, RSL };
