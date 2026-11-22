// 網站預約 → Notion「任務總表」自動開任務；Shopify 付款後在同一任務加收款記錄。
// 私隱：只寫入單號、服務類別、方案、寵物種類、服務日期及後台連結；
// 客人姓名、電話、地址及備註一律不寫入 Notion（資料只留在後台）。
// Notion 出錯不影響客人落單或付款處理（只記錄錯誤）。
//
// Vercel 環境變數：
//   NOTION_TOKEN        — Notion internal integration secret（未設定則整個功能略過）
//   NOTION_TASKS_DB     — 「任務總表」database ID（須分享給該 integration）
//   NOTION_ORDER_AI_ID  — 選填：「Resoul 訂單紀錄及跟進」頁面 ID，填入「負責 AI」
//   ADMIN_BASE_URL      — 選填：後台網址，預設 https://resoul-admin-five.vercel.app

const NOTION_VERSION = "2022-06-28";
const TIMEOUT_MS = 3000;

const KIND = {
  "web:cremation": "火化預約",
  "web:euthanasia": "安樂死預約",
  "web:pickup-deposit": "接送訂金",
};

function config() {
  const token = (process.env.NOTION_TOKEN || "").trim();
  const db = (process.env.NOTION_TASKS_DB || "").trim();
  if (!token || !db) return null;
  return {
    token,
    db,
    ai: (process.env.NOTION_ORDER_AI_ID || "").trim(),
    admin: (process.env.ADMIN_BASE_URL || "https://resoul-admin-five.vercel.app").trim().replace(/\/+$/, ""),
  };
}

async function notion(cfg, path, method, body) {
  const response = await fetch("https://api.notion.com/v1/" + path, {
    method,
    headers: { Authorization: "Bearer " + cfg.token, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error("notion_" + response.status + (data && data.code ? "_" + data.code : ""));
    error.status = response.status;
    throw error;
  }
  return data;
}

// 香港日期（YYYY-MM-DD）
function hkToday() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function text(content) {
  return [{ type: "text", text: { content: String(content).slice(0, 1900) } }];
}

// 任務名稱以「單號 290」結尾，付款時按此找回同一任務
const titleSuffix = (projectNo) => "單號 " + projectNo;

function line(label, value) {
  return { object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: text(label + "：" + value) } };
}

function todo(content) {
  return { object: "block", type: "to_do", to_do: { rich_text: text(content), checked: false } };
}

// 網站新預約 → 建立任務（狀態「進行中」、執行者 AI、類別 客戶）
async function createBookingTask(booking) {
  const cfg = config();
  if (!cfg) return;
  const projectNo = String(booking.projectNo || "").trim();
  const deposit = booking.deposit === true || booking.source === "web:pickup-deposit";
  const kind = KIND[booking.source] || (deposit ? "接送訂金" : "網站預約");
  const adminUrl = projectNo ? cfg.admin + "/projects/group/" + encodeURIComponent(projectNo) : cfg.admin + (deposit ? "/deposits" : "/bookings");
  const serviceDate = /^\d{4}-\d{2}-\d{2}$/.test(booking.serviceDate || "") ? booking.serviceDate : null;

  const properties = {
    "任務名稱": { title: text("網站" + kind + "｜" + (projectNo ? titleSuffix(projectNo) : "未配單號")) },
    "狀態": { status: { name: "進行中" } },
    "執行者": { select: { name: "AI" } },
    "類別": { select: { name: "客戶" } },
    "執行日期": { date: { start: hkToday() } },
    "成果連結": { url: adminUrl },
  };
  if (serviceDate) properties["截止日期"] = { date: { start: serviceDate } };

  const children = [
    { object: "block", type: "callout", callout: { icon: { type: "emoji", emoji: "🔒" }, rich_text: text("由網站自動建立。客人姓名、電話、地址及備註只存於後台，請按「成果連結」到後台查閱。AI 不可自行聯絡客人、報價或改 live 訂單。") } },
    line("公司單號", projectNo || "未配單號（請在後台配號）"),
    line("類別", kind),
    booking.plan ? line("方案", booking.plan) : null,
    booking.petType ? line("寵物種類", booking.petType) : null,
    line("服務日期", serviceDate || "未定"),
    booking.serviceTime ? line("時段", booking.serviceTime) : null,
    line("付款", deposit ? "客人經 Shopify 結帳付訂金；付款後會自動在此加記錄" : "未開付款連結（須同事在後台確認後開 Shopify 付款連結）"),
    { object: "block", type: "heading_3", heading_3: { rich_text: text("跟進清單") } },
    todo("在後台核對預約資料及檔期"),
    deposit ? todo("確認接送安排") : todo("同事確認價錢後，在後台開 Shopify 付款連結"),
    todo("付款後核對收款"),
  ].filter(Boolean);

  const page = { parent: { database_id: cfg.db }, properties, children };
  if (cfg.ai) page.properties["負責 AI"] = { relation: [{ id: cfg.ai }] };
  try {
    await notion(cfg, "pages", "POST", page);
  } catch (error) {
    // 「AI 同事」資料庫未分享給 integration 時，不填「負責 AI」再試一次
    if (!cfg.ai || (error.status !== 400 && error.status !== 404)) throw error;
    delete page.properties["負責 AI"];
    await notion(cfg, "pages", "POST", page);
  }
}

// Shopify 已付款 → 在該單號最新的任務加收款記錄（不改狀態；「已完成」只由負責人標記）
async function markTaskPaid(payment) {
  const cfg = config();
  const projectNo = String(payment.projectNo || "").trim();
  if (!cfg || !projectNo) return;
  const found = await notion(cfg, "databases/" + cfg.db + "/query", "POST", {
    filter: { property: "任務名稱", title: { ends_with: titleSuffix(projectNo) } },
    sorts: [{ timestamp: "created_time", direction: "descending" }],
    page_size: 1,
  });
  const page = found && Array.isArray(found.results) ? found.results[0] : null;
  if (!page) return;
  const money = Number.isFinite(payment.amount) ? " " + (payment.currency || "HKD") + " " + payment.amount : "";
  const note = "Shopify 已收款" + (payment.orderName ? " " + payment.orderName : "") + money + "（" + hkToday() + "）" + (payment.test ? "｜測試付款" : "") + "，請在後台核對收款。";
  await notion(cfg, "blocks/" + page.id + "/children", "PATCH", {
    children: [{ object: "block", type: "callout", callout: { icon: { type: "emoji", emoji: payment.test ? "🧪" : "✅" }, rich_text: text(note) } }],
  });
}

// 包裝：出錯只記錄，不拋出
const safe = (fn, label) => (args) =>
  fn(args).catch((error) => console.error("[Resoul] notion " + label + " failed:", error && error.message));

module.exports = {
  createBookingTask: safe(createBookingTask, "task"),
  markTaskPaid: safe(markTaskPaid, "paid"),
};
