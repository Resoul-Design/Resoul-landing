const crypto = require("crypto");
const { guardPublicPost, clean } = require("./_security");

function b64url(input) { return Buffer.from(input).toString("base64url"); }
function ymd(date) { return date.toISOString().slice(0, 10); }

function normalizeKey(value) {
  let key = String(value || "").trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) key = key.slice(1, -1);
  return key.replace(/\\r/g, "").replace(/\\n/g, "\n").trim();
}

async function googleToken(email, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" })) + "." +
    b64url(JSON.stringify({ iss: email, scope: "https://www.googleapis.com/auth/calendar.events", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const jwt = unsigned + "." + crypto.sign("RSA-SHA256", Buffer.from(unsigned), privateKey).toString("base64url");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=" + encodeURIComponent(jwt),
  });
  const data = await response.json();
  if (!data.access_token) throw new Error("calendar_token_failed");
  return data.access_token;
}

async function addCalendarEvent(booking) {
  let email = process.env.GCAL_CLIENT_EMAIL;
  let privateKey = process.env.GCAL_PRIVATE_KEY;
  let calendarId = process.env.GCAL_CALENDAR_ID;
  if (process.env.GCAL_SA_JSON) {
    const account = JSON.parse(process.env.GCAL_SA_JSON);
    email = account.client_email || email;
    privateKey = account.private_key || privateKey;
    calendarId = calendarId || account.calendar_id;
  }
  if (!email || !privateKey || !calendarId) return;
  const start = booking.service_date || ymd(new Date());
  const end = new Date(start + "T00:00:00Z");
  end.setUTCDate(end.getUTCDate() + 1);
  const token = await googleToken(email, normalizeKey(privateKey));
  const response = await fetch("https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(calendarId) + "/events", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({
      summary: (booking.source === "web:euthanasia" ? "安樂死預約（待確認）— " : "火化預約（待確認）— ") + booking.owner_name,
      description: ["主人：" + booking.owner_name, "電話：" + booking.contact, booking.plan ? "方案：" + booking.plan : null, booking.pet_type ? "寵物：" + booking.pet_type : null, booking.pickup_address ? "地點：" + booking.pickup_address : null, booking.notes || null].filter(Boolean).join("\n"),
      start: { date: start }, end: { date: ymd(end) },
    }),
  });
  if (!response.ok) throw new Error("calendar_insert_failed");
}

module.exports = async (req, res) => {
  if (!(await guardPublicPost(req, res, { endpoint: "booking", limit: 5, windowSeconds: 3600, maxBytes: 32768 }))) return;
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const ownerName = clean(body.name, 100);
  const contact = clean(body.phone, 40);
  if (!ownerName || !contact) return res.status(400).json({ error: "missing_contact" });
  const date = clean(body.date, 10);
  const booking = {
    owner_name: ownerName,
    contact,
    plan: clean(body.plan, 80) || null,
    pet_type: clean(body.pet, 80) || null,
    service_date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    pickup_address: clean(body.place, 300) || null,
    notes: clean(body.notes, 1500) || null,
    source: body.type === "euthanasia" ? "web:euthanasia" : "web:cremation",
    payment_ref: crypto.randomUUID(),
  };
  const sbUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !serviceKey) return res.status(503).json({ error: "server_not_configured" });
  const response = await fetch(sbUrl + "/rest/v1/cremation_bookings", {
    method: "POST",
    headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(booking),
  });
  if (!response.ok) return res.status(502).json({ error: "booking_store_failed" });
  const rows = await response.json();
  addCalendarEvent(rows[0] || booking).catch((error) => console.error("[Resoul] calendar sync failed:", error.message));
  return res.status(201).json({ ok: true });
};
