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
 * 未設 env 時回 { skipped:true }，best-effort，不會令 Shopify 重試風暴。
 */

const crypto = require("crypto");

function readRaw(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "method_not_allowed" }); return; }

  const raw = await readRaw(req);

  // 1) 強制驗證 HMAC；缺少 secret 時拒絕處理，避免錯誤配置變成繞過驗證。
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) { res.status(503).json({ error: "webhook_not_configured" }); return; }
  const hmac = req.headers["x-shopify-hmac-sha256"] || "";
  const digest = crypto.createHmac("sha256", secret).update(raw, "utf8").digest("base64");
  let ok = false;
  try { ok = crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac)); } catch (e) { ok = false; }
  if (!ok) { res.status(401).json({ error: "invalid_hmac" }); return; }

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
  if (!SB_URL || !SR) { res.status(200).json({ skipped: true, note: "supabase_env_missing" }); return; }

  try {
    const patch = {
      payment_status: "paid",
      payment_amount: order.total_price != null ? Number(order.total_price) : undefined,
      payment_currency: order.currency || undefined,
      shopify_order_id: order.id != null ? String(order.id) : undefined,
      shopify_order_name: order.name || (order.order_number ? "#" + order.order_number : undefined),
      paid_at: new Date().toISOString(),
    };
    // 同一 payment_ref 只會屬於其中一張表：火化付款問卷（cremation_bookings）
    // 或安排預約接送訂金（deposit_bookings）。兩張都試 PATCH，best-effort。
    const tables = ["cremation_bookings", "deposit_bookings"];
    let anyErr = "";
    for (const tbl of tables) {
      const url = SB_URL + "/rest/v1/" + tbl + "?payment_ref=eq." + encodeURIComponent(ref);
      const r = await fetch(url, {
        method: "PATCH",
        headers: {
          apikey: SR,
          Authorization: "Bearer " + SR,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(patch),
      });
      if (!r.ok) {
        const t = await r.text();
        // deposit_bookings 尚未建立時會 404/400，可忽略，不阻礙 cremation 更新。
        console.error("[Resoul] webhook patch " + tbl + " failed " + r.status + ": " + t);
        anyErr = "supabase_error";
      }
    }
    if (anyErr) { res.status(200).json({ ok: true, payment_ref: ref, note: anyErr }); return; }
    res.status(200).json({ ok: true, payment_ref: ref });
  } catch (err) {
    console.error("[Resoul] shopify-webhook error:", err && err.message);
    res.status(200).json({ ok: false, detail: "exception" });
  }
};
