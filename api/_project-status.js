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
      get("deposit_bookings", { select: "created_at,status,service_date,payment_status,paid_at,pet_name,contact", project_no: "eq." + projectNo }),
      get("cremation_bookings", {
        select: "created_at,status,source,service_date,payment_status,paid_at,pet_name,contact,case_no,notes,picked_up_at,cremation_started_at,ready_at,returned_at",
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

    const service = [...deposits, ...bookings];
    const cremation = bookings.filter((b) => !String(b.source || "").includes("euthanasia"));
    const vetOnly = bookings.length > 0 && !cremation.length && !deposits.length;
    const active = service.filter((r) => r.status !== "cancelled");
    const earliest = (rows, field) => rows.map((r) => r[field]).filter(Boolean).sort()[0] || null;
    const pet = (service.find((r) => r.pet_name) || {}).pet_name || "";

    let steps = [];
    if (service.length) {
      const paid = active.filter((r) => r.payment_status === "paid");
      const scheduled = active.filter((r) => LATER.includes(r.status));
      const c = cremation.filter((b) => b.status !== "cancelled");
      steps = vetOnly
        ? [
            { key: "received_vet", date: hkDate(earliest(service, "created_at")) },
            { key: "vet_scheduled", date: scheduled.length ? hkDate(earliest(scheduled, "service_date")) || "" : null },
            { key: "vet_done", date: active.some((r) => r.status === "completed") ? "" : null },
          ]
        : [
            { key: "received", date: hkDate(earliest(service, "created_at")) },
            { key: "paid", date: paid.length ? hkDate(earliest(paid, "paid_at") || earliest(paid, "created_at")) : null },
            { key: "scheduled", date: scheduled.length ? hkDate(earliest(scheduled, "service_date")) || "" : null },
            { key: "picked_up", date: hkDate(earliest(c, "picked_up_at")) },
            { key: "cremating", date: hkDate(earliest(c, "cremation_started_at")) },
            { key: "ready", date: hkDate(earliest(c, "ready_at")) },
            { key: "returned", date: hkDate(earliest(c, "returned_at")) },
          ];
    }
    const keepsakes = orders.map((o) => ({
      date: hkDate(o.shopify_created_at),
      items: (o.line_items || []).map((it) => String(it.title || "") + "×" + (it.quantity || 1)).join("、"),
      status: o.cancelled_at ? "cancelled" : o.fulfillment_status === "FULFILLED" ? "shipped" : ["PAID", "PARTIALLY_REFUNDED"].includes(o.financial_status) ? "preparing" : "pending",
    }));
    return res.status(200).json({
      found: true,
      pet,
      cancelled: service.length > 0 && !active.length,
      steps,
      keepsakes,
    });
  } catch (error) {
    console.error("[Resoul] project status request failed");
    return res.status(503).json({ error: "lookup_unavailable" });
  }
}

module.exports = { projectStatus, phoneKey, RSL };
