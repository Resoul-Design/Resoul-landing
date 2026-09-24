const { guardPublicPost, clean } = require("./_security");

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

  try {
    const [depositsResponse, bookingsResponse] = await Promise.all([
      fetch(base + "deposit_bookings?" + depositParams, { headers }),
      fetch(base + "cremation_bookings?" + bookingParams, { headers }),
    ]);
    if (!depositsResponse.ok || !bookingsResponse.ok) {
      console.error("[Resoul] project lookup database query failed");
      return res.status(503).json({ error: "lookup_unavailable" });
    }
    const [deposits, bookings] = await Promise.all([depositsResponse.json(), bookingsResponse.json()]);
    const found = deposits.some((row) => row.project_no === projectNo && phoneKey(row.contact) === phone) ||
      bookings.some((row) => (
        (String(row.case_no || "").toUpperCase() === projectNo || notesContainProject(row.notes, projectNo)) &&
        phoneKey(row.contact) === phone
      ));
    return res.status(200).json({ exists: found });
  } catch (error) {
    console.error("[Resoul] project lookup request failed");
    return res.status(503).json({ error: "lookup_unavailable" });
  }
};
