# 部署到 Vercel × Gemini API（情緒傾聽）

網站已準備好用 **Vercel serverless function** 保存 Gemini key：
- 前端呼叫同網域 `/api/grief-chat`（`api/grief-chat.js`），function 內加上手冊 system prompt 再呼叫 Gemini。
- **API key 只存喺 Vercel 專案嘅環境變數**，唔會出現喺前端、代碼或 GitHub。
- 未部署／本機開時，`/api/grief-chat` 會 404 → 前端自動回落內置規則引擎，唔會壞。

---

## 步驟 1｜攞 Gemini API key
去 https://aistudio.google.com/app/apikey → 登入 → **Create API key** → 複製（`AIza...`）。
> ⚠️ 唔好貼落任何前端檔案、代碼或 chat。

## 步驟 2｜用 GitHub import 到 Vercel（最簡單）
1. 去 https://vercel.com → 用 **GitHub 登入**。
2. **Add New… → Project** → 揀 `xavierchow61/resoul-landing` → **Import**。
3. Framework Preset 保持 **Other**（唔使 build）→ **Deploy**。
   - Vercel 會自動：把根目錄當靜態網站、把 `api/` 當 serverless function。

## 步驟 3｜加入 Gemini key（環境變數）
喺 Vercel 專案 → **Settings → Environment Variables**：
- **Name**：`GEMINI_API_KEY`
- **Value**：貼上你嘅 Gemini key
- **Environment**：Production（同 Preview 亦可）
- **Save**

## 安全設定：Supabase 全域限流

所有公開 POST API 都使用 Supabase RPC `consume_api_quota` 的持久化計數（表 `api_rate_limits`），不依賴 serverless 記憶體，亦毋須另設第三方服務。沿用 Vercel 現有環境變數：
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

請確保已在 Supabase 執行 `supabase/public_api_security.sql`（建立 `consume_api_quota`；可重複執行）。缺少上述設定或函數時，API 會 fail closed（回應 503），不會退回無限流模式。詳見 `SECURITY.md`；部署前亦須在 Supabase 先執行 `supabase/deposit_bookings.sql`（若訂金表尚未建立），再執行 `supabase/api_pii_security.sql`，鎖住預約個人資料表。

## 步驟 4｜重新部署令 key 生效
Vercel → **Deployments → 最新一個 → ⋯ → Redeploy**（或者 push 任何 commit 都會自動重新部署）。

完成後開你個 Vercel 網址（例如 `https://resoul-landing.vercel.app`），情緒傾聽就會用 Gemini 真實回應。

---

## 更新 / 更換 Gemini key
返 **Settings → Environment Variables → GEMINI_API_KEY → Edit** → 貼新 key → Save → Redeploy。

## 換模型 / 改語氣
- 模型：`api/grief-chat.js` 頂部 `const MODEL`（`gemini-2.5-flash` / `gemini-2.0-flash` / `gemini-1.5-flash`）。
- 語氣或規則：同檔 `SYSTEM_PROMPT`。
- 改完 push 上 GitHub，Vercel 自動重新部署。

## 運作與保底
- **危機關鍵字**（想死／撐唔住／傷害自己等）：前端**即時**顯示香港求助熱線，唔等 API，最安全。
- **Gemini 失敗／空回應／未部署**：自動回落內置規則引擎。
- **對話上下文**：前端會帶最近幾輪對話畀 Gemini，令回應連貫。

## 安全提醒
- `GEMINI_API_KEY` 只放喺 Vercel 環境變數，唔好寫入任何檔案或 commit。
- 費用：Gemini 有免費額度，輕量文字對話成本好低。

> 註：repo 內另有一份 `worker/`（Cloudflare Workers 版），係另一個部署選擇。用 Vercel 嘅話可以忽略佢，唔影響運作。
