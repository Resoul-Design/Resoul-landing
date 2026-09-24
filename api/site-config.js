const { requireAllowedOrigin } = require("./_security");

module.exports = (req, res) => {
  if (!requireAllowedOrigin(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  const previewUrl = process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production" && process.env.VERCEL_URL
    ? "https://" + process.env.VERCEL_URL
    : "https://resoul.hk";
  const configured = (process.env.SITE_URL || previewUrl).trim().replace(/\/+$/, "");
  let siteUrl = "https://resoul.hk";
  try {
    const parsed = new URL(configured);
    if (parsed.protocol === "https:") siteUrl = parsed.origin;
  } catch (error) {}
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
  res.status(200).json({ siteUrl });
};
