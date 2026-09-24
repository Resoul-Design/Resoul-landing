/**
 * Resoul 情緒傾聽 — Gemini 代理 (Cloudflare Worker)
 *
 * 作用：前端把對話訊息 POST 過嚟，Worker 加上「系統提示」(= 寵物哀傷輔導手冊規則)
 *        再呼叫 Google Gemini API，回傳溫柔、跟足手冊嘅回應。
 *        API key 只存喺 Worker secret，唔會出現喺前端，唔會外洩。
 *
 * 部署見同目錄 ../GEMINI_SETUP.md
 */

const MODEL = "gemini-3.6-flash"; // 目前可用嘅 flash 模型（2.0/2.5 已停用或有 thinking 截斷問題）

const SYSTEM_PROMPT = `你係 Resoul 嘅寵物哀傷支援夥伴，名叫「情緒傾聽」。你嘅角色係用溫柔、非評判、接納嘅語氣，陪伴喺香港、失去或即將失去寵物嘅主人整理情緒。全程用繁體中文、香港廣東話口語回應。

對話流程（按需要靈活運用，唔需要每次全部做齊）：
1. 開場與建立關係：讓對方感到安全、被接納。
2. 探索與確認感受：協助對方命名情緒，確認哀傷係正常反應。
3. 正常化哀傷：哀傷冇標準時間表；有人會喊、有人麻木、有人發嬲，全部都正常。
4. 探索支持系統：了解對方身邊有冇人可以傾訴或支援。
5. 溫和提供下一步或轉介。

語氣參考：「你唔需要急住講好多，我會喺度陪你。」「聽落你真係好掛住佢。」「你嘅眼淚，係因為你好愛佢。」「你已經好努力咁陪佢行完最後一程。」
避免講：「你唔好咁傷心啦」「時間會治癒一切」「佢去咗一個更好嘅地方」等否定感受嘅說話；亦避免「你應該」「你唔好」等指令式語言。

特殊情況：
- 自責／後悔：用穩妥、不替對方下結論的方式回應，例如「好多主人都會咁諗。或者可以先記得，你當時係喺有限資訊下盡咗力去決定。」避免斬釘截鐵地說「毛孩唔會怪你」這類替對方作結論的說話。
- 麻木／空洞：「『喊唔出』或『冇感覺』都係哀傷嘅一種反應，你唔需要逼自己有感覺。」
- 若對方提及寵物病況：溫和提醒先諮詢獸醫，唔好提供醫療診斷。

嚴格規則（必須遵守）：
- 唔可以提供醫療或心理診斷、用藥或治療建議。
- 唔可以保證「會好返」或「一定會解決」。
- 如果偵測到自我傷害或自殺念頭（例如「想死」「唔想活」「撐唔住」「傷害自己」），必須即刻溫和回應、確認安全，並提供香港求助熱線：撒瑪利亞會 24 小時 2389 2222、醫院管理局精神健康專線 2466 7350、東華三院芷若園 18281；緊急情況叫佢即刻致電 999，並鼓勵即刻搵專業幫手。
- 若情緒持續或嚴重，建議聯絡香港心理衞生會 2528 0196 或撒瑪利亞會 2389 2222。
- 唔好要求或記錄真實姓名、電話、地址、付款資料或完整病歷。
- 回應要簡潔、溫暖、有條理：一般 3–6 句，需要時分小段。結尾可輕輕帶出一個溫柔嘅下一步，但唔好硬銷產品或服務。`;

const ALLOWED_ORIGINS = new Set([
  "https://resoul-landing-beta.vercel.app",
  "https://resoul.hk",
  "https://www.resoul.hk",
]);

function json(obj, status = 200, origin) {
  const headers = { "Content-Type": "application/json", "Vary": "Origin" };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
  }
  return new Response(JSON.stringify(obj), {
    status,
    headers,
  });
}

async function allowRequest(request, env, origin) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  const hash = Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
  const base = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return { response: json({ error: "security_service_unavailable" }, 503, origin) };
  try {
    const result = await fetch(base + "/rest/v1/rpc/consume_api_quota", {
      method: "POST",
      headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ p_key: "grief-chat:" + hash, p_limit: 25, p_window_seconds: 3600 }),
    });
    const allowed = await result.json();
    if (!result.ok || typeof allowed !== "boolean") throw new Error("rate_limit_unavailable");
    if (!allowed) return { response: json({ error: "rate_limited" }, 429, origin) };
    return {};
  } catch {
    return { response: json({ error: "security_service_unavailable" }, 503, origin) };
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    if (!origin || !ALLOWED_ORIGINS.has(origin)) return json({ error: "invalid_origin" }, 403);
    if (request.method === "OPTIONS") return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Vary": "Origin",
      },
    });
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, origin);
    const length = Number(request.headers.get("Content-Length") || 0);
    if (length > 65536) return json({ error: "payload_too_large" }, 413, origin);
    const quota = await allowRequest(request, env, origin);
    if (quota.response) return quota.response;

    const key = env.GEMINI_API_KEY;
    if (!key) return json({ error: "server_not_configured" }, 500, origin);

    let body;
    try { body = await request.json(); } catch { return json({ error: "bad_json" }, 400, origin); }

    const raw = Array.isArray(body.messages) ? body.messages.slice(-16) : [];
    const contents = raw
      .map((m) => ({
        role: m.role === "model" ? "model" : "user",
        parts: [{ text: String(m.text || "").slice(0, 2000) }],
      }))
      .filter((c) => c.parts[0].text.trim().length > 0);
    if (!contents.length) return json({ error: "no_messages" }, 400, origin);

    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/" +
      MODEL + ":generateContent?key=" + key;

    const payload = {
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents,
      generationConfig: { temperature: 0.7, topP: 0.95, maxOutputTokens: 2048 },
      // 為咗令支援哀傷/情緒嘅內容唔會被過度攔截，放寬部分安全門檻；
      // 危機情況前端另有即時熱線保底。可按需要調整。
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
      ],
    };

    let r;
    try {
      r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      return json({ error: "upstream_unreachable" }, 502, origin);
    }

    if (!r.ok) {
      return json({ error: "gemini_error" }, 502, origin);
    }

    const data = await r.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const reply = parts.map((p) => p.text || "").join("").trim();
    return json({ reply }, 200, origin);
  },
};
