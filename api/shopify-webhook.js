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
    // 同一 payment_ref 只會屬於其中一張表；只有確認找到並更新記錄才回報成功。
    const tables = ["cremation_bookings", "deposit_bookings"];
    let updated = false;
    let failed = false;
    for (const tbl of tables) {
      const url = SB_URL + "/rest/v1/" + tbl + "?payment_ref=eq." + encodeURIComponent(ref);
      try {
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
        if (rows.length) updated = true;
      } catch (error) {
        console.error("[Resoul] webhook request failed for " + tbl);
        failed = true;
      }
    }
    if (updated) { res.status(200).json({ ok: true, payment_ref: ref }); return; }
    if (failed) { res.status(503).json({ error: "payment_update_failed" }); return; }
    res.status(200).json({ ok: true, payment_ref: ref, note: "payment_ref_not_found" });
  } catch (err) {
    console.error("[Resoul] shopify-webhook error:", err && err.message);
    res.status(500).json({ error: "webhook_processing_failed" });
  }
};
