/**
 * RESOUL — Shopify webhook：orders/paid → 更新 Supabase cremation_bookings 為已付
 *
 * Shopify 後台註冊 webhook（topic: orders/paid）指向：
 *   https://<你的網域>/api/shopify-webhook
 *
 * 需要 Vercel Environment Variables：
 *   SHOPIFY_WEBHOOK_SECRET      — Shopify webhook 簽署密鑰（驗證 HMAC）
 *   SUPABASE_URL                — 客戶 project，例：https://diyxcxkgvqvyrstrzttq.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY   — 客戶 project 的 service_role key（伺服器端專用，繞過 RLS 更新）
 *
 * 對應：前端落單時把 payment_ref 寫入 Shopify 訂單（cart attribute + line item property），
 *       這裡用 payment_ref 找回 Supabase 該筆預約並標記 paid。
 * Supabase 暫時失敗時回傳 5xx，讓 Shopify 重試付款狀態同步。
 */

const crypto = require("crypto");
const { requireAllowedOrigin } = require("./_security");

// 應付金額：接送訂金以固定訂金（DEPOSIT_AMOUNT，預設 1800）為準，不信任客人提交的金額；火化以預約收費金額為準
const DEPOSIT_AMOUNT = Number(process.env.DEPOSIT_AMOUNT || 1800);
function hk(n) { return "HK$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 }); }
function amountProblem(expected, paid, currency, orderName) {
  const order = orderName || "Shopify 訂單";
  if (!(Number(expected) > 0)) return "⚠️ 未設定收費金額，未能核對 " + order + " 實付 " + (Number.isFinite(paid) ? hk(paid) : "—") + "；請人手確認收款";
  if (!Number.isFinite(paid)) return "⚠️ " + order + " 未有付款金額，未能核對；請人手確認收款";
  if (currency && String(currency).toUpperCase() !== "HKD") return "⚠️ " + order + " 貨幣為 " + currency + "，未能核對；請人手確認收款";
  if (paid + 0.5 < Number(expected)) return "⚠️ 付款金額不符：應付 " + hk(expected) + "，" + order + " 實付 " + hk(paid) + "，未標記已付款";
  return null;
}
function appendNote(notes, line) {
  const base = String(notes || "").trim();
  return (base ? base + " | " + line : line).slice(0, 4000);
}

function readRaw(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

module.exports = async (req, res) => {
  // Shopify server-to-server webhooks omit Origin and are authenticated by HMAC.
  // If a browser Origin is present, it must still be one of our trusted sites.
  if (req.headers.origin && !requireAllowedOrigin(req, res)) return;
  if (!req.headers.origin && !req.headers["x-shopify-hmac-sha256"]) {
    res.status(403).json({ error: "invalid_origin" });
    return;
  }
  if (req.method !== "POST") { res.status(405).json({ error: "method_not_allowed" }); return; }

  const raw = await readRaw(req);

  // 1) 強制驗證 HMAC；缺少 secret 時拒絕處理，避免錯誤配置變成繞過驗證。
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) { res.status(503).json({ error: "webhook_not_configured" }); return; }
  const hmac = req.headers["x-shopify-hmac-sha256"] || "";
  const digest = crypto.createHmac("sha256", secret).update(raw, "utf8").digest("base64");
  let ok = false;
  try { ok = crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac)); } catch (e) { ok = false; }
  if (!ok) {
    if (!req.headers.origin) { res.status(403).json({ error: "invalid_origin" }); return; }
    res.status(401).json({ error: "invalid_hmac" });
    return;
  }

  // 2) 解析訂單
  let order;
  try { order = JSON.parse(raw); } catch (e) { res.status(400).json({ error: "bad_json" }); return; }

  // 只處理「已付款」：其他 webhook 主題或未付款狀態一律略過
  const topic = String(req.headers["x-shopify-topic"] || "");
  if (topic && topic !== "orders/paid") { res.status(200).json({ ok: true, note: "ignored_topic" }); return; }
  if (order.financial_status && order.financial_status !== "paid") { res.status(200).json({ ok: true, note: "not_paid" }); return; }

  // 3) 找 payment_ref（先看 note_attributes，再看 line item properties）
  let ref = null;
  (order.note_attributes || []).forEach((a) => {
    const k = a.name || a.key; if (k === "payment_ref" && a.value) ref = a.value;
  });
  if (!ref) {
    (order.line_items || []).forEach((li) => {
      (li.properties || []).forEach((p) => {
        const k = p.name || p.first; const v = p.value || p.last;
        if (k === "payment_ref" && v) ref = v;
      });
    });
  }
  if (!ref) { res.status(200).json({ ok: true, note: "no_payment_ref" }); return; }

  // 4) 更新 Supabase（service_role，繞過 RLS）
  const SB_URL = process.env.SUPABASE_URL;
  const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SB_URL || !SR) { res.status(503).json({ error: "supabase_not_configured" }); return; }

  try {
    const patch = {
      payment_status: "paid",
      payment_amount: order.total_price != null ? Number(order.total_price) : undefined,
      payment_currency: order.currency || undefined,
      shopify_order_id: order.id != null ? String(order.id) : undefined,
      shopify_order_name: order.name || (order.order_number ? "#" + order.order_number : undefined),
      paid_at: new Date().toISOString(),
    };
    // Shopify 測試付款：付款標記成功後另行標記為測試記錄（best-effort；欄位未建立時略過）
    const markTest = async (tbl) => {
      if (order.test !== true) return;
      try {
        await fetch(SB_URL + "/rest/v1/" + tbl + "?payment_ref=eq." + encodeURIComponent(ref), {
          method: "PATCH",
          headers: { apikey: SR, Authorization: "Bearer " + SR, "Content-Type": "application/json" },
          body: JSON.stringify({ is_test: true }),
        });
      } catch (e) {}
    };
    // 同一 payment_ref 只會屬於其中一張表；只有確認找到並更新記錄才回報成功。
    const tables = ["cremation_bookings", "deposit_bookings"];
    let updated = false;
    let failed = false;
    const orderName = order.name || (order.order_number ? "#" + order.order_number : null);
    const paidAmount = order.total_price != null ? Number(order.total_price) : NaN;
    let mismatch = false;
    for (const tbl of tables) {
      const url = SB_URL + "/rest/v1/" + tbl + "?payment_ref=eq." + encodeURIComponent(ref);
      try {
        // 先讀取記錄核對金額；已付款則不重複處理
        const cur = await fetch(url + "&select=id,payment_amount,payment_status,notes", { headers: { apikey: SR, Authorization: "Bearer " + SR } });
        if (!cur.ok) { failed = true; continue; }
        const curRows = await cur.json();
        if (!Array.isArray(curRows) || !curRows.length) continue;
        const pending = curRows.filter((x) => x.payment_status !== "paid");
        if (!pending.length) { updated = true; continue; }
        const expected = tbl === "deposit_bookings" ? DEPOSIT_AMOUNT : Number(pending[0].payment_amount);
        const problem = amountProblem(expected, paidAmount, order.currency, orderName);
        if (problem) {
          for (const x of pending) {
            await fetch(SB_URL + "/rest/v1/" + tbl + "?id=eq." + encodeURIComponent(x.id), {
              method: "PATCH",
              headers: { apikey: SR, Authorization: "Bearer " + SR, "Content-Type": "application/json" },
              body: JSON.stringify({ payment_status: "failed", notes: appendNote(x.notes, problem) }),
            });
          }
          console.error("[Resoul] webhook amount mismatch for " + tbl);
          mismatch = true;
          continue;
        }
        const r = await fetch(url, {
          method: "PATCH",
          headers: {
            apikey: SR,
            Authorization: "Bearer " + SR,
            "Content-Type": "application/json",
            Prefer: "return=representation",
          },
          body: JSON.stringify(patch),
        });
        if (!r.ok) {
          console.error("[Resoul] webhook patch failed for " + tbl + " (" + r.status + ")");
          failed = true;
          continue;
        }
        const rows = await r.json();
        if (!Array.isArray(rows)) {
          failed = true;
          continue;
        }
        if (rows.length) { updated = true; await markTest(tbl); }
      } catch (error) {
        console.error("[Resoul] webhook request failed for " + tbl);
        failed = true;
      }
    }
    if (mismatch) { res.status(200).json({ ok: true, payment_ref: ref, note: "amount_mismatch" }); return; }
    if (updated) { res.status(200).json({ ok: true, payment_ref: ref }); return; }
    if (failed) { res.status(503).json({ error: "payment_update_failed" }); return; }
    res.status(200).json({ ok: true, payment_ref: ref, note: "payment_ref_not_found" });
  } catch (err) {
    console.error("[Resoul] shopify-webhook error:", err && err.message);
    res.status(500).json({ error: "webhook_processing_failed" });
  }
};
