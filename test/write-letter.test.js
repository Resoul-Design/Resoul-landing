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

// 以 mock 取代 Supabase 限流 RPC 及 Gemini；回傳送往 Gemini 的提示
async function callWriteLetter(body, { quotaAllowed = true } = {}) {
  const saved = {
    fetch: global.fetch,
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    gemini: process.env.GEMINI_API_KEY,
  };
  let prompt = null;
  let quotaKey = null;
  global.fetch = async (url, options) => {
    if (String(url).includes("/rpc/consume_api_quota")) {
      quotaKey = JSON.parse(options.body).p_key;
      return { ok: true, json: async () => quotaAllowed };
    }
    prompt = JSON.parse(options.body).contents[0].parts[0].text;
    return {
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: "修改後的信" }] } }] }),
    };
  };
  process.env.SUPABASE_URL = "https://project.supabase.example";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
  process.env.GEMINI_API_KEY = "test-key";
  try {
    const res = response();
    await loadApi("api/write-letter.js")({
      method: "POST",
      headers: { origin: "https://resoul-landing-beta.vercel.app" },
      body,
    }, res);
    return { res, prompt, quotaKey };
  } finally {
    global.fetch = saved.fetch;
    for (const [name, value] of [["SUPABASE_URL", saved.url], ["SUPABASE_SERVICE_ROLE_KEY", saved.key], ["GEMINI_API_KEY", saved.gemini]]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

const LETTER = "親愛的豆豆：謝謝你陪我走過十二年。每天放工你都在門口等我。";

test("shorten revises the existing letter instead of writing a new one", async () => {
  const { res, prompt } = await callWriteLetter({ adjust: "shorten", current: LETTER, lang: "zh" });
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { letter: "修改後的信" });
  assert.ok(prompt.includes("原信：\n" + LETTER), "prompt should carry the current letter");
  assert.match(prompt, /縮短約三分之一/);
  assert.equal(prompt.includes("長度約 220–340 字"), false, "revision must not use the fresh-letter prompt");
});

test("tone revision keeps the letter and applies the requested tone", async () => {
  const { res, prompt } = await callWriteLetter({ adjust: "tone", tone: "calm", current: LETTER });
  assert.equal(res.code, 200);
  assert.ok(prompt.includes(LETTER));
  assert.match(prompt, /語氣改為「calm」/);
});

test("memory revision weaves the new memory into the existing letter", async () => {
  const { res, prompt } = await callWriteLetter({ adjust: "memory", addMemory: "牠最愛在窗邊曬太陽", current: LETTER });
  assert.equal(res.code, 200);
  assert.ok(prompt.includes(LETTER));
  assert.ok(prompt.includes("牠最愛在窗邊曬太陽"));
});

test("revision rejects unknown adjustments and an empty memory", async () => {
  const unknown = await callWriteLetter({ adjust: "rewrite", current: LETTER });
  assert.equal(unknown.res.code, 400);
  assert.deepEqual(unknown.res.body, { error: "invalid_adjust" });
  assert.equal(unknown.prompt, null);

  const noMemory = await callWriteLetter({ adjust: "memory", current: LETTER });
  assert.equal(noMemory.res.code, 400);
  assert.deepEqual(noMemory.res.body, { error: "no_input" });
});

test("a fresh letter still uses the full writing prompt", async () => {
  const { res, prompt } = await callWriteLetter({ petName: "豆豆", memory: "每天在門口等我" });
  assert.equal(res.code, 200);
  assert.match(prompt, /長度約 220–340 字/);
  assert.equal(prompt.includes("原信："), false);
});

test("an exhausted quota returns 429 so the page can disable the AI buttons", async () => {
  const { res, prompt } = await callWriteLetter({ adjust: "shorten", current: LETTER }, { quotaAllowed: false });
  assert.equal(res.code, 429);
  assert.deepEqual(res.body, { error: "rate_limited" });
  assert.equal(prompt, null, "Gemini must not be called once rate limited");
});

test("story drafts on the share page use a separate quota from letters", async () => {
  const letter = await callWriteLetter({ petName: "豆豆" });
  assert.match(letter.quotaKey, /^write-letter:[a-f0-9]{64}$/);
  const story = await callWriteLetter({ purpose: "story", petName: "豆豆" });
  assert.equal(story.res.code, 200);
  assert.match(story.quotaKey, /^write-story:[a-f0-9]{64}$/);
});
