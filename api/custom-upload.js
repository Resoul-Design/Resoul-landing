const crypto = require("crypto");
const { guardPublicPost } = require("./_security");

module.exports = async (req, res) => {
  if (!(await guardPublicPost(req, res, { endpoint: "custom-upload", limit: 8, windowSeconds: 3600, maxBytes: 2500000 }))) return;
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const match = String(body.image || "").match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return res.status(400).json({ error: "invalid_image" });
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > 1500000) return res.status(413).json({ error: "image_too_large" });
  const sbUrl = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !key) return res.status(503).json({ error: "server_not_configured" });
  const ext = match[1] === "image/png" ? "png" : match[1] === "image/webp" ? "webp" : "jpg";
  const path = "orders/" + crypto.randomUUID() + "." + ext;
  const response = await fetch(sbUrl + "/storage/v1/object/custom-uploads/" + path, {
    method: "POST",
    headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": match[1], "x-upsert": "false" },
    body: bytes,
  });
  if (!response.ok) return res.status(502).json({ error: "upload_failed" });
  return res.status(201).json({ url: sbUrl + "/storage/v1/object/public/custom-uploads/" + path });
};
