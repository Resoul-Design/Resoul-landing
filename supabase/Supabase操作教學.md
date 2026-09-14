# RESOUL · Supabase 操作教學（中英對照 / Bilingual Guide）

> 此文件說明 RESOUL 網站用到的 Supabase 資料如何操作：審核分享頁故事、查看火化預約、執行 SQL、以及各項安全須知。
> This guide explains how to operate the Supabase data used by the RESOUL site: moderating board stories, viewing cremation bookings, running SQL, and key security notes.

---

## 0. 登入與專案 / Sign in & project

- **中：** 用 **resouldesigner@gmail.com** 登入 <https://supabase.com> → 進入 RESOUL 專案。左邊工具列有 **Table Editor（資料表）**、**SQL Editor**、**Storage（檔案）**、**Authentication（帳號）**、**Project Settings（設定）**。
- **EN:** Sign in at <https://supabase.com> with **resouldesigner@gmail.com** → open the RESOUL project. The left sidebar has **Table Editor**, **SQL Editor**, **Storage**, **Authentication**, and **Project Settings**.

---

## 1. 分享頁故事審核 / Moderating board stories （最常用 / most common）

分享頁（board.html）的留言存在 `posts` 資料表。新留言預設為 **待審**，不會自動公開。
Stories from the board are stored in the `posts` table. New posts default to **held** and are NOT shown until you approve them.

**`status` 欄位 / the `status` column**
| 值 value | 意思 meaning |
|---|---|
| `held` | 待審（新收到，未顯示）/ pending review, not shown |
| `visible` | 已審核並公開顯示 / approved & shown publicly |
| `hidden` | 隱藏（不顯示）/ hidden |

**操作步驟 / Steps**
1. **中：** Table Editor → 選 `posts` 表 → 找 `status = held` 的新留言。
   **EN:** Table Editor → open `posts` → find new rows where `status = held`.
2. **中：** 看內容合適 → 把該列 `status` 改為 **`visible`** → 儲存。想下架就改成 `hidden`。
   **EN:** If the content is appropriate → change that row's `status` to **`visible`** → save. To take it down, set `hidden`.
3. **中：** 只有 `visibility = public` 且 `status = visible` 的故事會出現喺公開列表。
   **EN:** Only stories with `visibility = public` AND `status = visible` appear in the public list.

**`visibility` 欄位（由使用者提交時選擇，一般不用改）/ `visibility` column (chosen by the user; usually no need to change)**
- `public` 公開 → 審核後顯示喺分享頁 / shown on the board after approval
- `link` 只限連結 → 唔會列出，只有持 `?s=<slug>` 連結先睇到 / unlisted, only reachable via its `?s=<slug>` link
- `private` 私人保存 → **只存喺使用者自己嘅瀏覽器（localStorage）**；Supabase 這邊唔會顯示、亦唔提供連結，你**唔需要／唔應該**在後台操作它 / kept in the **visitor's own browser (localStorage)** only; not shown and not linkable here — nothing to manage on the backend

> 提醒 / Note：互動只有「留下心意（❤️ 計數）」，沒有公開留言功能，避免二次傷害。
> Interactions are limited to hearts (❤️ count); there are no public comments, by design.

---

## 2. 火化預約 / Cremation bookings

火化預約（cremation.html 的表單）存在 `cremation_bookings` 表。
Cremation bookings (from the form on cremation.html) are stored in `cremation_bookings`.

- **中：** Table Editor → `cremation_bookings` → 依 `created_at` 排序睇最新預約；重要欄位：`owner_name`、`contact`（電話／WhatsApp）、`pet_name`、`plan`、`service_date`、`status`、`payment_status`、`shopify_order_name`（發票編號）。
- **EN:** Table Editor → `cremation_bookings` → sort by `created_at` for the latest; key fields: `owner_name`, `contact` (phone/WhatsApp), `pet_name`, `plan`, `service_date`, `status`, `payment_status`, `shopify_order_name` (invoice no.).
- **中：** 日常請用 **admin 後台**（resoul-admin）睇預約會更方便（有排期、日曆、發票、WhatsApp 客人等）。Supabase 只作最底層資料庫。
- **EN:** For daily work use the **admin dashboard** (resoul-admin) — it has scheduling, calendar, invoices, WhatsApp-to-customer, etc. Supabase is the underlying database.

---

## 3. 執行 SQL（安裝／更新資料庫規則）/ Running SQL (install / update DB rules)

`supabase/` 資料夾內的 `.sql` 檔是資料庫結構與安全規則。若日後叫你「跑一段 SQL」：
The `.sql` files in the `supabase/` folder define the schema and security rules. When asked to "run some SQL":

1. **中：** Supabase → **SQL Editor** → New query。
   **EN:** Supabase → **SQL Editor** → New query.
2. **中：** 打開對應的 `.sql` 檔，全選內容 → 貼上 → 按 **Run**。
   **EN:** Open the relevant `.sql` file, copy all → paste → click **Run**.
3. 檔案用途 / What each file is for：
   - `schema.sql` — 基本資料表（posts、cremation_bookings 等）/ base tables
   - `memorial_stories.sql` — 分享頁 posts 與心意計數 / board posts & hearts
   - `payment_tracking.sql` — 火化預約的付款追蹤欄位 / payment fields for bookings
   - `security_hardening.sql` — 安全強化（RLS、觸發器、`get_post_by_slug` RPC）/ security hardening

> 這些 SQL 可**重複執行**（用 `create or replace` / `if not exists`），跑多次唔會整壞資料。
> These scripts are **idempotent** (`create or replace` / `if not exists`); re-running them is safe.

---

## 4. 圖片儲存 / Image storage

- **中：** 分享頁上載的相片存喺 **Storage → `board-images`** bucket（公開讀取）。要移除不當相片，喺該 bucket 刪除對應檔案即可。
- **EN:** Photos uploaded on the board live in **Storage → `board-images`** (public read). To remove an inappropriate photo, delete the file in that bucket.

---

## 5. 金鑰與安全 / Keys & security

| 金鑰 Key | 用途 Use | 可否公開 Public? |
|---|---|---|
| **anon / publishable key** | 前端網站（landing）讀寫，受 RLS 保護 | ✅ 可公開（已在網站程式內）/ safe to expose |
| **service_role key** | 只限 admin 後台（繞過 RLS）| ❌ 絕不可外洩 / never expose |

- **中：** 前端只用 anon key；所有寫入受 **RLS（Row Level Security）** 限制：訪客只能新增（`held` 待審），不能改／刪別人的資料。審核（改 status）須在 Supabase 後台或 admin（service_role）進行。
- **EN:** The public site uses only the anon key; all writes are constrained by **RLS**: visitors can only insert (as `held`), never edit/delete others' data. Moderation (changing status) happens in Supabase or the admin (service_role).
- **中：** `service_role` key 只放喺 admin 的 Vercel 環境變數，切勿貼上網站、GitHub 或對話。
- **EN:** The `service_role` key lives only in the admin's Vercel env vars — never paste it into the website, GitHub, or chat.

---

## 6. 常見情況 / Quick answers

- **「有人分享咗故事但睇唔到？」** → 正常，新故事預設 `held`，要你審核改 `visible`。
  **"Someone shared but it's not showing?"** → Expected; new posts are `held` until you set `visible`.
- **「私人保存的故事點解 Supabase 冇？」** → 私人保存只存喺使用者自己瀏覽器，唔會上傳到可查閱的地方，屬設計上的私隱保護。
  **"Why aren't private-saved stories in Supabase?"** → Private saves stay in the visitor's own browser by design (privacy); there's nothing to view here.
- **「想畀使用者一條可再睇的連結？」** → 叫佢用「只限連結」模式，系統會生成 `?s=<slug>` 連結。
  **"Want a re-viewable link for a user?"** → Use the "link-only" mode; the site generates a `?s=<slug>` link.

---

_最後更新 / Last updated: 2026-09-14_
