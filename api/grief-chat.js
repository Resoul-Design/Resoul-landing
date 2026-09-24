/**
 * Resoul 情緒傾聽 — Gemini 代理 (Vercel Serverless Function)
 *
 * 前端 POST /api/grief-chat，這裡加上手冊 system prompt 再呼叫 Gemini。
 * GEMINI_API_KEY 存於 Vercel 專案的 Environment Variables，不會出現在前端或 git。
 *
 * 設定見同 repo 的 VERCEL_SETUP.md
 */

const fs = require("fs");
const path = require("path");

const MODEL = "gemini-3.6-flash"; // 目前可用嘅 flash 模型（2.0/2.5 已停用或有 thinking 截斷問題）
const { guardPublicPost } = require("./_security");

// 後備提示：萬一讀取唔到 HANDBOOK.md，就用呢個。
// 正常會優先用 HANDBOOK.md 內 <!-- PROMPT:START --> ~ <!-- PROMPT:END --> 之間嘅內容。
const DEFAULT_PROMPT = `你係 Resoul 嘅寵物哀傷支援夥伴，名叫「情緒傾聽」。你嘅角色係用溫柔、非評判、接納嘅語氣，陪伴喺香港、失去或即將失去寵物嘅主人整理情緒。語言：跟隨用戶所用語言回應——如果用戶用中文，全程用繁體中文、香港廣東話口語；如果用戶用英文，就全程用溫柔、自然嘅英文回應（保持同樣嘅同理心與語氣）。下面嘅語氣示例為廣東話，回應英文用戶時請以英文表達相同意思。

【首要任務：情緒支持行先】
1. 開場與建立關係：讓對方感到安全、被接納。
2. 探索與確認感受：協助對方命名情緒，確認哀傷係正常反應。
3. 正常化哀傷：哀傷冇標準時間表；有人會喊、有人麻木、有人發嬲，全部都正常。
4. 探索支持系統：了解對方身邊有冇人可以傾訴。
5. 溫和提供下一步或轉介。

語氣參考：「你唔需要急住講好多，我會喺度陪你。」「聽落你真係好掛住佢。」「你嘅眼淚，係因為你好愛佢。」
避免講：「你唔好咁傷心啦」「時間會治癒一切」「佢去咗一個更好嘅地方」；避免「你應該」「你唔好」等指令式語言。

特殊情況：
- 自責／後悔：用穩妥、不替對方下結論的方式回應，例如「好多主人都會咁諗。或者可以先記得，你當時係喺有限資訊下盡咗力去決定。」避免斬釘截鐵地說「毛孩唔會怪你」。
- 麻木／空洞：「『喊唔出』或『冇感覺』都係哀傷嘅一種反應，你唔需要逼自己有感覺。」
- 寵物病重或考慮安樂死：唔做醫療判斷，建議同獸醫討論生活品質評估；溫和肯定「你會咁認真思考，正正代表你好用心守護緊佢」。

【背景知識：只喺用戶問起先自然、簡短提供，唔主動推銷、唔主動報價，最後可輕輕帶去 Resoul 官方資料】
- 離世當下（溫柔實務，非醫療）：先畀自己時間同毛孩道別；遺體約 2–4 小時內會僵硬，可趁早輕柔調整成側臥睡姿、闔眼；香港潮濕，室溫調低（約 18°C 以下）、避免陽光直射、墊尿墊保持乾爽；準備好就聯絡專業善終接送。
- Resoul 服務：24 小時遺體接送（緊急熱線 +852 6476 2951）、「一爐一寵」獨立火化（絕不集體）、遺體潔淨、海景告別室告別儀式、一對一編號追蹤、雲端影像記錄。
- 火化 vs 水化：亦有水化（Aquamation，更環保、骨灰更白更多，但需時較長）。火化方案有風之旅／雲之旅／星之旅。若被問價錢，只需說「按體重計、$1,800 起」並建議睇官方收費表，唔好詳細報價或硬銷。
- 紀念方式：紀念寶石／骨灰鑽石、骨灰盅、手工陶瓷腳印、毛髮寶石、木雕擺設、紋印純銀首飾（鼻紋＋指紋）等。

嚴格規則（必須遵守）：
- 唔可以提供醫療或心理診斷、用藥或治療建議。
- 唔可以保證「會好返」或「一定會解決」。
- 情緒支持行先，唔好主動推銷產品或服務；只喺用戶問起先簡短提供服務資訊，並輕輕帶去官方資料。
- 危機（例如「想死」「唔想活」「撐唔住」「傷害自己」）→ 即刻溫和回應、確認安全，並提供：撒瑪利亞防止自殺會 24 小時 2389 2222、醫院管理局精神健康專線 2466 7350、東華三院芷若園 18281；緊急致電 999，鼓勵即刻搵專業幫手。
- 若情緒持續或嚴重，建議聯絡香港心理衞生會 2528 0196 或撒瑪利亞防止自殺會 2389 2222。
- 唔好要求或記錄真實姓名、電話、地址、付款資料或完整病歷。
- 回應要簡潔、溫暖、有條理：一般 3–6 句，需要時分小段。`;

// 由 HANDBOOK.md 讀取系統提示（PROMPT:START ~ PROMPT:END 之間），讀唔到就用 DEFAULT_PROMPT。
function loadSystemPrompt() {
  const candidates = [
    path.join(process.cwd(), "HANDBOOK.md"),
    path.join(__dirname, "..", "HANDBOOK.md"),
    path.join(__dirname, "HANDBOOK.md"),
  ];
  for (const p of candidates) {
    try {
      const md = fs.readFileSync(p, "utf8");
      const m = md.match(/<!--\s*PROMPT:START\s*-->([\s\S]*?)<!--\s*PROMPT:END\s*-->/);
      if (m && m[1].trim().length > 40) return m[1].trim();
    } catch (e) { /* try next */ }
  }
  return DEFAULT_PROMPT;
}

const SYSTEM_PROMPT = loadSystemPrompt();

module.exports = async (req, res) => {
  if (!(await guardPublicPost(req, res, { endpoint: "grief-chat", limit: 25, windowSeconds: 3600, maxBytes: 65536 }))) return;

  const key = process.env.GEMINI_API_KEY;
  if (!key) { res.status(500).json({ error: "server_not_configured" }); return; }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  if (!body || typeof body !== "object") body = {};

  const raw = Array.isArray(body.messages) ? body.messages.slice(-16) : [];
  const contents = raw
    .map((m) => ({
      role: m && m.role === "model" ? "model" : "user",
      parts: [{ text: String((m && m.text) || "").slice(0, 2000) }],
    }))
    .filter((c) => c.parts[0].text.trim().length > 0);
  if (!contents.length) { res.status(400).json({ error: "no_messages" }); return; }

  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    MODEL + ":streamGenerateContent?alt=sse&key=" + key;

  const payload = {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents,
    generationConfig: { temperature: 0.7, topP: 0.95, maxOutputTokens: 2048, candidateCount: 1 },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
    ],
  };

  let upstream;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    res.status(502).json({ error: "upstream_unreachable" });
    return;
  }
  if (!upstream.ok || !upstream.body) {
    res.status(502).json({ error: "gemini_error" });
    return;
  }

  // 串流回應：逐段將文字寫回前端（text/plain）
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line || line.startsWith(":") || !line.startsWith("data:")) continue;
        const js = line.slice(5).trim();
        if (js === "[DONE]") continue;
        try {
          const obj = JSON.parse(js);
          const parts = (obj && obj.candidates && obj.candidates[0] &&
            obj.candidates[0].content && obj.candidates[0].content.parts) || [];
          const text = parts.map((p) => (p && p.text) || "").join("");
          if (text) res.write(text);
        } catch (e) { /* 分段的 JSON，等下一段 */ }
      }
    }
  } catch (e) { /* 串流中斷，直接收尾 */ }
  res.end();
};
