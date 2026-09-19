const crypto = require("crypto");

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    (req.socket && req.socket.remoteAddress) || "unknown";
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === String(host);
  } catch {
    return false;
  }
}

async function consumeQuota(req, endpoint, limit, windowSeconds) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("rate_limit_not_configured");
  const subject = crypto.createHash("sha256").update(clientIp(req)).digest("hex");
  const response = await fetch(url + "/rest/v1/rpc/consume_api_quota", {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_key: endpoint + ":" + subject,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    }),
  });
  if (!response.ok) throw new Error("rate_limit_unavailable");
  return Boolean(await response.json());
}

async function guardPublicPost(req, res, options) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return false;
  }
  if (!sameOrigin(req)) {
    res.status(403).json({ error: "invalid_origin" });
    return false;
  }
  const maxBytes = options.maxBytes || 65536;
  if (Number(req.headers["content-length"] || 0) > maxBytes) {
    res.status(413).json({ error: "payload_too_large" });
    return false;
  }
  try {
    const allowed = await consumeQuota(
      req,
      options.endpoint,
      options.limit || 10,
      options.windowSeconds || 60
    );
    if (!allowed) {
      res.status(429).json({ error: "rate_limited" });
      return false;
    }
  } catch (error) {
    console.error("[Resoul] public API guard failed:", error && error.message);
    res.status(503).json({ error: "security_service_unavailable" });
    return false;
  }
  return true;
}

function clean(value, max) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

module.exports = { guardPublicPost, clean };

