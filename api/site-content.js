// 後台「網站內容」：收費表、紀念精品、商店分類、常見問題及頁頂公告。
// 頁面 HTML 保留預設內容；此端點回傳後台已儲存的版本，由 js/site-content.js 替換。
// 未執行 db/migration_site_content.sql 或讀取失敗時回傳空物件，頁面維持預設內容。
const KEYS = new Set([
  "notice",
  "prices.cremation",
  "prices.vet",
  "prices.grief",
  "keepsakes",
  "shop.categories",
  "faq.cremation",
  "faq.euthanasia",
  "faq.support",
]);

module.exports = async function siteContent(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  // 用標準 URL 解析查詢字串（避免 Node url.parse 棄用警告）
  const keys = String(new URL(req.url || "/", "http://localhost").searchParams.get("keys") || "")
    .split(",")
    .map((k) => k.trim())
    .filter((k) => KEYS.has(k));
  if (!keys.length) return res.status(400).json({ error: "no_keys" });

  const sbUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !serviceKey) return res.status(503).json({ error: "server_not_configured" });

  const fallback = () => res.setHeader("Cache-Control", "public, max-age=0, s-maxage=30").status(200).json({});
  try {
    const response = await fetch(`${sbUrl}/rest/v1/site_content?${new URLSearchParams({
      select: "key,data",
      key: `in.(${keys.map((k) => `"${k}"`).join(",")})`,
    })}`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      cache: "no-store",
    });
    if (!response.ok) {
      console.error("[Resoul] Site content read failed", response.status);
      return fallback();
    }
    const rows = await response.json();
    const out = {};
    rows.forEach((row) => { if (KEYS.has(row.key) && row.data && typeof row.data === "object") out[row.key] = row.data; });
    // 邊緣快取 60 秒：後台儲存後約一分鐘內生效
    return res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=600").status(200).json(out);
  } catch (error) {
    console.error("[Resoul] Site content request failed", error);
    return fallback();
  }
};
