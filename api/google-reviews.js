module.exports = async function googleReviews(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const sbUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !serviceKey) return res.status(503).json({ error: "server_not_configured" });

  try {
    const query = new URLSearchParams({
      select: "display_name,rating,zh_content,en_content,photo_url,source_url",
      is_published: "eq.true",
      order: "sort_order.asc,created_at.asc",
    });
    const response = await fetch(`${sbUrl}/rest/v1/google_reviews?${query}`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      cache: "no-store",
    });
    if (!response.ok) {
      console.error("[Resoul] Google reviews read failed", response.status);
      return res.status(502).json({ error: "reviews_unavailable" });
    }

    const rows = await response.json();
    return res.setHeader("Cache-Control", "no-store").status(200).json(rows.map((row) => ({
      name: row.display_name,
      rating: row.rating,
      zh: row.zh_content,
      en: row.en_content,
      photo: row.photo_url,
      sourceUrl: row.source_url,
    })));
  } catch (error) {
    console.error("[Resoul] Google reviews request failed", error);
    return res.status(502).json({ error: "reviews_unavailable" });
  }
};
