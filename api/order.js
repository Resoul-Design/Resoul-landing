const { guardPublicPost, clean } = require("./_security");

// 火化「付款問卷」下單：以 service_role 寫入 cremation_bookings（繞過 RLS），
// 保留前端產生的 payment_ref，讓 Shopify orders/paid webhook 事後配對標記已付款。
module.exports = async (req, res) => {
  if (!(await guardPublicPost(req, res, { endpoint: "order", limit: 8, windowSeconds: 3600, maxBytes: 32768 }))) return;
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const ownerName = clean(body.owner_name, 100);
  const contact = clean(body.contact, 40);
  const paymentRef = clean(body.payment_ref, 60);
  if (!ownerName || !contact || !paymentRef) return res.status(400).json({ error: "missing_fields" });

  const date = clean(body.service_date, 10);
  const amount = Number(body.payment_amount);
  const base = {
    owner_name: ownerName,
    contact,
    plan: clean(body.plan, 80) || null,
    pet_type: clean(body.pet_type, 80) || null,
    service_date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    pickup_address: clean(body.pickup_address, 300) || null,
    notes: clean(body.notes, 1500) || null,
    source: clean(body.source, 40) || "web:cremation-order",
  };
  const petName = clean(body.pet_name, 100) || null;
  const full = Object.assign({}, base, {
    pet_name: petName,
    payment_ref: paymentRef,
    payment_status: "pending",
    payment_amount: Number.isFinite(amount) ? amount : null,
    payment_currency: clean(body.payment_currency, 10) || "HKD",
  });

  const sbUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !serviceKey) return res.status(503).json({ error: "server_not_configured" });

  function insert(payload) {
    return fetch(sbUrl + "/rest/v1/cremation_bookings", {
      method: "POST",
      headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(payload),
    });
  }

  let response = await insert(full);
  if (!response.ok) {
    const detail = await response.text();
    // 若資料表未建立付款 / pet_name 欄位，退回基本欄位（Ref 仍保留在 notes 內）重試。
    if (/payment_ref|payment_status|payment_amount|payment_currency|pet_name/i.test(detail)) {
      response = await insert(base);
    }
    if (!response.ok) {
      console.error("[Resoul] order store failed");
      return res.status(502).json({ error: "order_store_failed" });
    }
  }
  return res.status(201).json({ ok: true });
};
