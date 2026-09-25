/**
 * Resoul 寫信助手 — Gemini 代理（Vercel Serverless Function）
 *
 * 前端 POST /api/write-letter，收集毛孩資料，回傳一封告別信初稿。
 * GEMINI_API_KEY 存於 Vercel 環境變數（與 grief-chat 共用）。
 * 回應：{ letter: "..." }。屬草稿，主人可自行修改。
 */

const MODEL = "gemini-3.6-flash";
const { guardPublicPost } = require("./_security");

function clean(s, n) { return String(s == null ? "" : s).slice(0, n || 400).trim(); }

const REVISE_ADJUSTS = new Set(["shorten", "tone", "memory"]);

module.exports = async (req, res) => {
  let b = req.body;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  b = b || {};

  // 情緒支援頁寫信（letter）與分享頁草擬故事（story）分開計算限流配額
  const endpoint = b.purpose === "story" ? "write-story" : "write-letter";
  // maxBytes 32KB：修改信件時會附上原信（中文 UTF-8 每字 3 bytes）
  if (!(await guardPublicPost(req, res, { endpoint, limit: 8, windowSeconds: 3600, maxBytes: 32768 }))) return;

  const key = process.env.GEMINI_API_KEY;
  if (!key) { res.status(500).json({ error: "server_not_configured" }); return; }

  const petName = clean(b.petName, 60);
  const years = clean(b.years, 60);
  const trait = clean(b.trait, 300);
  const memory = clean(b.memory, 600);
  const thanks = clean(b.thanks, 400);
  const sorry = clean(b.sorry, 400);
  const tone = clean(b.tone, 40) || "溫柔";
  const lang = clean(b.lang, 20) || "zh";
  const adjust = clean(b.adjust, 20);
  const current = clean(b.current, 6000);
  const addMemory = clean(b.addMemory, 600);
  // 修改模式：附上原信（current）時，只按 adjust 修改現有信件，而非重寫
  const revising = Boolean(current);
  if (revising && !REVISE_ADJUSTS.has(adjust)) { res.status(400).json({ error: "invalid_adjust" }); return; }
  if (revising && adjust === "memory" && !addMemory) { res.status(400).json({ error: "no_input" }); return; }
  // 舊版前端（未附原信）仍可用 shorten 重寫一封較短的信
  const adjustLine = !revising && adjust === "shorten" ? "\n請將這封信寫得更精煉、比一般再短約三分之一，只保留最真摯的重點。" : "";

  if (!revising && !petName && !memory && !trait) { res.status(400).json({ error: "no_input" }); return; }

  const langLine = lang === "en"
    ? "Write the letter in warm, natural English."
    : lang === "bi"
      ? "Write the letter in Traditional Chinese (Hong Kong), then append an English version after a line break and a divider."
      : "用繁體中文（香港）書寫，語氣自然、貼近日常說話。";

  const reviseLine = adjust === "shorten"
    ? "將信縮短約三分之一，只保留最真摯的重點；不要加入新的內容或事實。"
    : adjust === "tone"
      ? "將整封信的語氣改為「" + tone + "」；保留原有內容、事實、段落次序及語言，只調整措辭。"
      : "把以下回憶自然地融入信中合適的位置，其餘內容盡量保持不變：" + addMemory;

  const prompt = revising
    ? "你是一位溫柔的寫作助手。以下是一位主人寫給已離世毛孩的告別信。請按修改要求修改這封信，" +
      "保留主人第一人稱的口吻、原信所用的語言（中文、英文或中英雙語）以及『四道人生』（道謝、道愛、道歉、道別）的心意；" +
      "不要杜撰原信及修改要求以外的事實。" +
      "只輸出修改後的信件內容本身，不要標題、不要解釋、不要加引號，亦不要輸出字數、統計或任何標籤。\n\n" +
      "修改要求：" + reviseLine + "\n\n原信：\n" + current + "\n"
    :
    "你是一位溫柔的寫作助手，協助一位剛失去寵物的主人，寫一封『給毛孩的告別信』。" +
    "請以主人第一人稱、向毛孩傾訴的口吻書寫，真誠、具體、不濫情，長度約 220–340 字。" +
    "信件請自然地承載『四道人生』的心意，順序融入、但不要用小標題或條列，讓它讀起來像一封完整的信：" +
    "① 道謝——謝謝牠陪伴的日子與帶來的溫暖；② 道愛——把心裡的愛清楚說出口；" +
    "③ 道歉——放下遺憾，也原諒當時已盡力的自己；④ 道別——溫柔地說一聲再見，讓愛以另一種方式延續。" +
    "若某一道所需資料未提供，可用真摯而不杜撰事實的方式輕輕帶過，四道都要有，但不要生硬。" +
    "只輸出信件內容本身（可用 2–4 個自然段），不要標題、不要解釋、不要加引號、不要標明第幾道。" +
    "絕對不要輸出任何字數、統計、括號註解或標籤（例如「120 characters」「約 200 字」「(120字)」）。" +
    "結尾以一句溫柔的道別收束，但不要用『敬上』這類公文式結尾。\n\n" +
    "語氣：" + tone + "。\n" + langLine + adjustLine + "\n\n" +
    "資料（可能不完整，缺的請自然略過，不要杜撰事實）：\n" +
    "毛孩名字：" + (petName || "（未提供）") + "\n" +
    "相處年期：" + (years || "（未提供）") + "\n" +
    "性格／習慣：" + (trait || "（未提供）") + "\n" +
    "最想保留的回憶：" + (memory || "（未提供）") + "\n" +
    "想感謝牠的：" + (thanks || "（未提供）") + "\n" +
    "想道歉或放不下的：" + (sorry || "（未提供）") + "\n";

  const url = "https://generativelanguage.googleapis.com/v1beta/models/" + MODEL + ":generateContent?key=" + key;
  const payload = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.8, topP: 0.95, maxOutputTokens: 4096, candidateCount: 1 },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
    ],
  };

  let r;
  try {
    r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  } catch (e) { res.status(502).json({ error: "upstream_unreachable" }); return; }
  if (!r.ok) { res.status(502).json({ error: "gemini_error" }); return; }

  let data;
  try { data = await r.json(); } catch (e) { res.status(502).json({ error: "bad_response" }); return; }
  const letter = (((data.candidates || [])[0] || {}).content || {}).parts;
  let text = Array.isArray(letter) ? letter.map((p) => p.text || "").join("").trim() : "";
  if (!text) { res.status(502).json({ error: "empty" }); return; }

  // 保險：清走 AI 偶然加喺開頭嘅字數／統計標籤（例如「120 characters）」「約200字」「(120字)」）
  text = text
    .replace(/^﻿/, "")
    .replace(/^\s*[（(]?\s*(約|approx\.?)?\s*\d+\s*(字|個字|characters?|words?)\s*[）)]?\s*[\r\n]*/i, "")
    .replace(/^\s*[（(][^）)\n]{0,40}(字|characters?|words?)[^）)\n]{0,10}[）)]\s*[\r\n]*/i, "")
    .trim();
  if (!text) { res.status(502).json({ error: "empty" }); return; }

  res.status(200).json({ letter: text });
};
