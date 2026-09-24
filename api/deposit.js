const { guardPublicPost, clean } = require("./_security");

// 「安排預約接送」訂金下單：以 service_role 寫入 deposit_bookings（繞過 RLS），
// 保留前端產生的 payment_ref，讓 Shopify orders/paid webhook 事後配對標記已付款。
// 需先於 Supabase 執行 supabase/deposit_bookings.sql 建立資料表。
module.exports = async (req, res) => {
  if (!(await guardPublicPost(req, res, { endpoint: "deposit", limit: 8, windowSeconds: 3600, maxBytes: 32768 }))) return;
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const ownerName = clean(body.owner_name, 100);
  const contact = clean(body.contact, 40);
  const paymentRef = clean(body.payment_ref, 60);
  const projectNo = clean(body.project_no, 40).toUpperCase();
  if (!ownerName || !contact || !paymentRef || !/^RSL-[A-Z0-9]+-[A-Z0-9]+$/.test(projectNo)) return res.status(400).json({ error: "missing_or_invalid_fields" });

  const date = clean(body.service_date, 10);
  const amount = Number(body.payment_amount);
  const full = {
    owner_name: ownerName,
    contact,
    project_no: projectNo,
    pet_name: clean(body.pet_name, 100) || null,
    pet_type: clean(body.pet_type, 80) || null,
    service_date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    service_time: clean(body.service_time, 60) || null,
    pickup_address: clean(body.pickup_address, 300) || null,
    notes: clean(body.notes, 1500) || null,
    source: clean(body.source, 40) || "web:cremation-deposit",
    payment_ref: paymentRef,
    payment_status: "pending",
    payment_amount: Number.isFinite(amount) ? amount : 1800,
    payment_currency: clean(body.payment_currency, 10) || "HKD",
  };

  const sbUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !serviceKey) return res.status(503).json({ error: "server_not_configured" });

  const response = await fetch(sbUrl + "/rest/v1/deposit_bookings", {
    method: "POST",
    headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(full),
  });
  if (!response.ok) {
    console.error("[Resoul] deposit store failed");
    return res.status(502).json({ error: "deposit_store_failed" });
  }
  return res.status(201).json({ ok: true });
};
