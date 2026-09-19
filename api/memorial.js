const crypto = require("crypto");
const { guardPublicPost, clean } = require("./_security");

module.exports = async (req, res) => {
  if (!(await guardPublicPost(req, res, { endpoint: "memorial", limit: 5, windowSeconds: 3600, maxBytes: 2500000 }))) return;
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const story = clean(body.story, 4000);
  const pet = clean(body.pet, 100);
  if (!pet && !story && !body.image) return res.status(400).json({ error: "missing_content" });
  const sbUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !serviceKey) return res.status(503).json({ error: "server_not_configured" });

  let imagePath = null;
  if (body.image) {
    const match = String(body.image).match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
    if (!match) return res.status(400).json({ error: "invalid_image" });
    const bytes = Buffer.from(match[1], "base64");
    if (bytes.length > 1500000) return res.status(413).json({ error: "image_too_large" });
    imagePath = "memorial/" + crypto.randomUUID() + ".jpg";
    const upload = await fetch(sbUrl + "/storage/v1/object/board-images/" + imagePath, {
      method: "POST",
      headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey, "Content-Type": "image/jpeg", "x-upsert": "false" },
      body: bytes,
    });
    if (!upload.ok) return res.status(502).json({ error: "upload_failed" });
  }

  const visibility = body.visibility === "link" ? "link" : "public";
  const slug = visibility === "link" ? crypto.randomUUID() : undefined;
  const record = {
    context: "memorial", pet_name: pet || null, years: clean(body.years, 80) || null,
    one_line: clean(body.oneLine, 300) || null, body: story || clean(body.oneLine, 300) || "（分享了一張相片）",
    name: clean(body.name, 100) || null, image_path: imagePath, visibility, slug,
  };
  const insert = await fetch(sbUrl + "/rest/v1/posts", {
    method: "POST",
    headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(record),
  });
  if (!insert.ok) return res.status(502).json({ error: "insert_failed" });
  return res.status(201).json({ ok: true, slug: slug || null });
};

