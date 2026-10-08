const { guardPublicPost, clean } = require("./_security");
const { projectStatus } = require("./_project-status");

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

module.exports = async (req, res) => {
  if (!(await guardPublicPost(req, res, { endpoint: "project-lookup", limit: 20, windowSeconds: 3600, maxBytes: 4096 }))) return;
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const projectNo = clean(body.project_no, 40).toUpperCase();
  const phone = phoneKey(clean(body.contact, 40));
  if (!/^RSL-[A-Z0-9]+-[A-Z0-9]+$/.test(projectNo) || !phone) {
    return res.status(400).json({ error: "invalid_lookup" });
  }
  // 查詢進度頁（/track）：回傳服務階段
  if (body.detail === true) return projectStatus(projectNo, phone, res);

  const sbUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !serviceKey) return res.status(503).json({ error: "lookup_unavailable" });

  const base = sbUrl.replace(/\/+$/, "") + "/rest/v1/";
  const headers = { apikey: serviceKey, Authorization: "Bearer " + serviceKey };
  const depositParams = new URLSearchParams({ select: "project_no,contact", project_no: "eq." + projectNo });
  const bookingParams = new URLSearchParams({
    select: "case_no,contact,notes",
    or: "(case_no.eq." + projectNo + ",notes.ilike.*" + projectNo + "*)",
  });
  // 紀念品訂單（網上商店直接購買時自動產生的編號）；未執行 migration_product_order_project_no.sql 時略過
  const orderParams = new URLSearchParams({ select: "project_no,phone", project_no: "eq." + projectNo });

  try {
    const [depositsResponse, bookingsResponse, ordersResponse] = await Promise.all([
      fetch(base + "deposit_bookings?" + depositParams, { headers }),
      fetch(base + "cremation_bookings?" + bookingParams, { headers }),
      fetch(base + "product_orders?" + orderParams, { headers }),
    ]);
    if (!depositsResponse.ok || !bookingsResponse.ok) {
      console.error("[Resoul] project lookup database query failed");
      return res.status(503).json({ error: "lookup_unavailable" });
    }
    const [deposits, bookings] = await Promise.all([depositsResponse.json(), bookingsResponse.json()]);
    const orders = ordersResponse.ok ? await ordersResponse.json() : [];
    const found = deposits.some((row) => row.project_no === projectNo && phoneKey(row.contact) === phone) ||
      bookings.some((row) => (
        (String(row.case_no || "").toUpperCase() === projectNo || notesContainProject(row.notes, projectNo)) &&
        phoneKey(row.contact) === phone
      )) ||
      orders.some((row) => String(row.project_no || "").toUpperCase() === projectNo && phoneKey(row.phone) === phone);
    return res.status(200).json({ exists: found });
  } catch (error) {
    console.error("[Resoul] project lookup request failed");
    return res.status(503).json({ error: "lookup_unavailable" });
  }
};
