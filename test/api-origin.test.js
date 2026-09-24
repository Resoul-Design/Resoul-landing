import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function loadApi(relativePath) {
  const filename = path.join(repo, relativePath);
  const module = { exports: {} };
  const nativeRequire = createRequire(filename);
  const localRequire = (id) => id.startsWith(".")
    ? loadApi(path.relative(repo, path.resolve(path.dirname(filename), id)) + (path.extname(id) ? "" : ".js"))
    : nativeRequire(id);
  const wrapper = vm.runInThisContext(`(function (require, module, exports, __filename, __dirname) { ${fs.readFileSync(filename, "utf8")}\n})`, { filename });
  wrapper(localRequire, module, module.exports, filename, path.dirname(filename));
  return module.exports;
}

function response() {
  return {
    code: 200,
    body: undefined,
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader() {},
  };
}

const browserHandlers = [
  ["booking", loadApi("api/booking.js"), "POST"],
  ["booking-calendar", loadApi("api/booking-calendar.js"), "GET"],
  ["custom-upload", loadApi("api/custom-upload.js"), "POST"],
  ["deposit", loadApi("api/deposit.js"), "POST"],
  ["grief-chat", loadApi("api/grief-chat.js"), "POST"],
  ["memorial", loadApi("api/memorial.js"), "POST"],
  ["order", loadApi("api/order.js"), "POST"],
  ["site-config", loadApi("api/site-config.js"), "POST"],
  ["write-letter", loadApi("api/write-letter.js"), "POST"],
];

test("all browser API handlers reject untrusted, missing, and null origins first", async () => {
  for (const [name, handler, method] of browserHandlers) {
    for (const origin of [undefined, "null", "https://evil.example", "https://resoul-landing-beta.vercel.app.evil.example"]) {
      const req = { method, headers: { ...(origin === undefined ? {} : { origin }) }, body: {} };
      const res = response();
      await handler(req, res);
      assert.equal(res.code, 403, `${name} should reject Origin ${origin}`);
      assert.deepEqual(res.body, { error: "invalid_origin" });
    }
  }
});

test("trusted origins reach route validation and the legacy calendar route stays 410", async () => {
  const previousFetch = global.fetch;
  const previousUrl = process.env.SUPABASE_URL;
  const previousToken = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const previousGeminiKey = process.env.GEMINI_API_KEY;
  global.fetch = async () => ({ ok: true, json: async () => true });
  process.env.SUPABASE_URL = "https://project.supabase.example";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
  process.env.GEMINI_API_KEY = "test-key";
  try {
    for (const origin of [
      "https://resoul-landing-beta.vercel.app",
      "https://resoul.hk",
      "https://www.resoul.hk",
    ]) {
      for (const [name, handler] of browserHandlers.filter(([name]) => !["site-config", "booking-calendar"].includes(name))) {
        const res = response();
        await handler({ method: "POST", headers: { origin }, body: {} }, res);
        assert.equal(res.code, 400, `${name} should reach business validation for ${origin}`);
      }
      const config = response();
      await loadApi("api/site-config.js")({ method: "POST", headers: { origin }, body: {} }, config);
      assert.equal(config.code, 200);
      assert.ok(config.body.siteUrl);
    }
    const calendar = response();
    await loadApi("api/booking-calendar.js")(
      { method: "GET", headers: { origin: "https://resoul.hk" } },
      calendar
    );
    assert.equal(calendar.code, 410);
    assert.deepEqual(calendar.body, { error: "use_booking_endpoint" });
  } finally {
    global.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousToken === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousToken;
    if (previousGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousGeminiKey;
  }
});

test("Shopify webhook requires HMAC when its server-to-server request has no Origin", async () => {
  const res = response();
  await loadApi("api/shopify-webhook.js")({ method: "POST", headers: {}, on() {} }, res);
  assert.equal(res.code, 403);
  assert.deepEqual(res.body, { error: "invalid_origin" });

  const oldSecret = process.env.SHOPIFY_WEBHOOK_SECRET;
  process.env.SHOPIFY_WEBHOOK_SECRET = "test-secret";
  try {
    const signedButInvalid = response();
    await loadApi("api/shopify-webhook.js")({
      method: "POST",
      headers: { "x-shopify-hmac-sha256": "invalid" },
      on(event, callback) { if (event === "end") callback(); },
    }, signedButInvalid);
    assert.equal(signedButInvalid.code, 403);
    assert.deepEqual(signedButInvalid.body, { error: "invalid_origin" });
  } finally {
    if (oldSecret === undefined) delete process.env.SHOPIFY_WEBHOOK_SECRET;
    else process.env.SHOPIFY_WEBHOOK_SECRET = oldSecret;
  }
});

test("shared POST guard uses the Supabase quota RPC and rejects when over the limit", async () => {
  const oldFetch = global.fetch;
  const oldUrl = process.env.SUPABASE_URL;
  const oldToken = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let calledUrl;
  let payload;
  global.fetch = async (url, options) => {
    calledUrl = url;
    payload = JSON.parse(options.body);
    return { ok: true, json: async () => false };
  };
  process.env.SUPABASE_URL = "https://project.supabase.example/";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
  try {
    const res = response();
    const passed = await loadApi("api/_security.js").guardPublicPost({
      method: "POST",
      headers: { origin: "https://resoul.hk", "x-forwarded-for": "203.0.113.10" },
    }, res, { endpoint: "grief-chat", limit: 2, windowSeconds: 3600 });
    assert.equal(passed, false);
    assert.equal(res.code, 429);
    assert.equal(calledUrl, "https://project.supabase.example/rest/v1/rpc/consume_api_quota");
    assert.match(payload.p_key, /^grief-chat:[a-f0-9]{64}$/);
    assert.equal(payload.p_limit, 2);
    assert.equal(payload.p_window_seconds, 3600);
    assert.equal(JSON.stringify(payload).includes("203.0.113.10"), false);
  } finally {
    global.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = oldUrl;
    if (oldToken === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = oldToken;
  }
});

test("shared POST guard fails closed with 503 when the quota service is not configured", async () => {
  const oldUrl = process.env.SUPABASE_URL;
  const oldToken = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const res = response();
    const passed = await loadApi("api/_security.js").guardPublicPost({
      method: "POST",
      headers: { origin: "https://resoul.hk" },
    }, res, { endpoint: "booking" });
    assert.equal(passed, false);
    assert.equal(res.code, 503);
    assert.deepEqual(res.body, { error: "security_service_unavailable" });
  } finally {
    if (oldUrl !== undefined) process.env.SUPABASE_URL = oldUrl;
    if (oldToken !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = oldToken;
  }
});
