# 情緒傾聽 × Gemini API 連接步驟

情緒傾聽而家有兩個模式：
- **未設定** → 用內置嘅規則式引擎（離線可用）。
- **設定咗 Worker 網址** → 用真 Gemini，根據對話內容回應（跟足手冊 system prompt）。

API key **唔會放喺前端**；佢只存喺 Cloudflare Worker 嘅 secret，經 Worker 代理呼叫 Gemini，安全唔外洩。

---

## 步驟 1｜攞一個 Gemini API key（免費額度）
1. 去 https://aistudio.google.com/app/apikey
2. 用 Google 帳戶登入 → **Create API key**
3. 複製個 key（`AIza...`）。**唔好貼落任何前端檔案或聊天室。**

## 步驟 2｜安裝 wrangler（Cloudflare CLI）
```bash
npm install -g wrangler
wrangler login
```

## 步驟 3｜設定 secret 並部署 Worker
喺 `resoul-landing/worker/` 目錄下：
```bash
cd resoul-landing/worker
wrangler secret put GEMINI_API_KEY
# 提示時貼上你嘅 Gemini key，按 Enter
wrangler deploy
```
另請以 `wrangler secret put` 設定 `SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY`（限流使用 Supabase RPC `consume_api_quota`，須先執行 `supabase/public_api_security.sql`）；聊天 API 沒有持久化限流服務時會拒絕處理。
部署成功會顯示一個網址，例如：
```
https://resoul-grief-chat.<你的子網域>.workers.dev
```
複製呢個網址。

## 步驟 4｜連接前端
開 `resoul-landing/index.html`，搵：
```js
var GRIEF_API = ""; // ← 貼上 Worker 網址
```
改成：
```js
var GRIEF_API = "https://resoul-grief-chat.你的子網域.workers.dev";
```
儲存後重新整理網頁，情緒傾聽就會用 Gemini 真實回應。

---

## 運作與保底
- **危機關鍵字**（想死／撐唔住／傷害自己等）：前端**即時**顯示香港求助熱線，唔會等 API，最安全。
- **Gemini 失敗 / 空回應 / 未設定**：自動回落到內置規則引擎，唔會壞。
- **對話上下文**：前端會帶最近幾輪對話畀 Gemini，令回應連貫。

## 想換模型 / 調整語氣
- 改模型：`worker/grief-chat.js` 頂部 `const MODEL`（`gemini-2.5-flash` / `gemini-2.0-flash` / `gemini-1.5-flash`）。
- 改語氣或規則：同檔 `SYSTEM_PROMPT`（已載入手冊全部規則）。
- 改完 `wrangler deploy` 再部署一次即生效。

## 費用
Gemini 有免費額度；超額按用量計。情緒傾聽屬輕量文字對話，成本好低。詳情見 Google AI Studio 定價。

## 安全提醒
- 唔好將 `GEMINI_API_KEY` 寫入 `wrangler.toml`、`index.html` 或任何會 commit 上 git 嘅檔案。
- 只用 `wrangler secret put` 儲存。
