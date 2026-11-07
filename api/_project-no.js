// 新專案編號＝公司單號（例如 290）：由 Supabase 函數 new_company_project() 一次過配號。
// 需先執行 resoul-admin/db/migration_20261108_company_invoice_no.sql。舊 RSL- 專案維持不變。
async function newProjectNo() {
  const sbUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !serviceKey) return null;
  try {
    const response = await fetch(sbUrl.replace(/\/+$/, "") + "/rest/v1/rpc/new_company_project", {
      method: "POST",
      headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey, "Content-Type": "application/json" },
      body: "{}",
    });
    if (!response.ok) throw new Error("http_" + response.status);
    const value = await response.json();
    return Number.isInteger(value) && value > 0 ? String(value) : null;
  } catch (error) {
    console.error("[Resoul] new project number failed:", error.message);
    return null;
  }
}

// 把專案編號填入備註中留空的「專案編號：」／「Project number:」位置；沒有該欄位則加在最前
function withProjectNo(notes, projectNo) {
  const text = String(notes || "");
  if (text.includes(projectNo)) return text || null;
  const filled = text.replace(/(專案編號：|Project (?:number|no\.):)[ ]*(?=([|｜]|$))/i, (match, label, next) =>
    label + (label.endsWith(":") ? " " : "") + projectNo + (next === "|" ? " " : ""));
  return (filled !== text ? filled : ["專案編號：" + projectNo, text].filter(Boolean).join("｜")).slice(0, 1600);
}

module.exports = { newProjectNo, withProjectNo };
