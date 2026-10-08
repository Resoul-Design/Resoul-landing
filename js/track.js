/* 查詢進度：輸入專案編號＋電話，顯示善終服務階段（/api/project-status） */
(function () {
  "use strict";
  var EN = (document.documentElement.lang || "").toLowerCase().indexOf("en") === 0;
  function L(zh, en) { return EN ? en : zh; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  var LABELS = {
    received: [L("已收到預約", "Booking received"), L("我們已收到你的預約資料。", "We have your booking details.")],
    paid: [L("已付訂金", "Deposit paid"), L("付款已確認。", "Payment confirmed.")],
    scheduled: [L("已安排接送", "Pick-up arranged"), L("團隊已與你確認接送安排。", "Our team has confirmed the pick-up with you.")],
    picked_up: [L("已接送", "Collected"), L("毛孩已由我們溫柔接回。", "Your companion is now in our gentle care.")],
    cremating: [L("火化中", "Cremation in progress"), L("正為毛孩進行獨立火化。", "The individual cremation is taking place.")],
    ready: [L("骨灰可取回", "Ashes ready"), L("骨灰已準備好，我們會聯絡你安排取回。", "The ashes are ready; we will contact you to arrange collection.")],
    returned: [L("已交還", "Returned home"), L("毛孩已回到你身邊。", "Your companion is home with you.")],
    received_vet: [L("已收到查詢", "Enquiry received"), L("我們已收到你的上門安樂死查詢。", "We have your home euthanasia enquiry.")],
    vet_scheduled: [L("已安排上門", "Home visit arranged"), L("已與你確認獸醫上門安排。", "The vet's home visit has been confirmed with you.")],
    vet_done: [L("已完成", "Completed"), L("上門服務已完成。", "The home visit is complete.")]
  };
  var KEEPSAKE = {
    pending: L("待付款", "Awaiting payment"),
    preparing: L("製作／準備中", "Being prepared"),
    shipped: L("已出貨", "Shipped"),
    cancelled: L("已取消", "Cancelled")
  };
  function fmt(d) {
    if (!d) return "";
    var p = d.split("-");
    return EN ? new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : Number(p[1]) + " 月 " + Number(p[2]) + " 日";
  }

  var form = document.getElementById("trackForm");
  if (!form) return;
  var project = document.getElementById("tkProject");
  var phone = document.getElementById("tkPhone");
  var msg = document.getElementById("trackMsg");
  var result = document.getElementById("trackResult");
  var btn = form.querySelector("button[type=submit]");

  // 預填：網址 ?no= 或之前在商店輸入的專案編號
  try {
    var q = new URLSearchParams(location.search).get("no");
    project.value = (q || localStorage.getItem("resoul:projectNo") || "").toUpperCase();
  } catch (e) {}

  function show(kind, html) {
    msg.className = "book-msg " + kind;
    msg.innerHTML = html;
    msg.hidden = false;
  }

  function render(data) {
    var steps = data.steps || [];
    var reached = steps.filter(function (s) { return s.date !== null; }).length;
    var html = '<div class="track-card">';
    if (data.pet) html += '<p class="track-pet">' + esc(L("毛孩：", "Companion: ")) + "<b>" + esc(data.pet) + "</b></p>";
    if (data.cancelled) html += '<p class="track-cancel">' + esc(L("此預約已取消。如有疑問，請聯絡我們。", "This booking has been cancelled. Please contact us if you have any questions.")) + "</p>";
    if (steps.length) {
      html += '<ol class="track-steps">';
      steps.forEach(function (s, i) {
        var state = s.date !== null ? "done" : i === reached ? "current" : "todo";
        var label = LABELS[s.key] || [s.key, ""];
        html += '<li class="' + state + '"><span class="track-dot" aria-hidden="true"></span><div><div class="track-step">' + esc(label[0]) +
          (s.date ? '<span class="track-date">' + esc(fmt(s.date)) + "</span>" : "") + "</div>" +
          (state !== "todo" ? '<div class="track-desc">' + esc(state === "current" ? L("下一步", "Next step") : label[1]) + "</div>" : "") + "</div></li>";
      });
      html += "</ol>";
    }
    if (data.keepsakes && data.keepsakes.length) {
      html += '<div class="track-keep"><div class="track-step">' + esc(L("紀念品", "Keepsakes")) + "</div><ul>";
      data.keepsakes.forEach(function (k) {
        html += "<li>" + esc(k.items || "—") + ' <span class="track-date">' + esc(KEEPSAKE[k.status] || "") + "</span></li>";
      });
      html += "</ul></div>";
    }
    html += "</div>";
    result.innerHTML = html;
    result.hidden = false;
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    msg.hidden = true;
    result.hidden = true;
    var no = project.value.trim().toUpperCase();
    if (!/^RSL-[A-Z0-9]+-[A-Z0-9]+$/.test(no) || phone.value.replace(/\D/g, "").length < 8) {
      show("err", esc(L("請輸入以 RSL- 開頭的專案編號及 8 位電話號碼。", "Please enter a project number starting with RSL- and an 8-digit phone number.")));
      return;
    }
    var old = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = esc(L("查詢中…", "Checking…"));
    fetch("/api/project-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_no: no, contact: phone.value })
    }).then(function (r) {
      if (r.status === 429) throw new Error("rate");
      if (!r.ok) throw new Error("server");
      return r.json();
    }).then(function (data) {
      if (!data.found) {
        show("err", esc(L("找不到與此電話相符的記錄，請檢查專案編號及電話。", "We couldn't find a record matching this phone number. Please check the project number and phone.")));
        return;
      }
      try { localStorage.setItem("resoul:projectNo", no); } catch (err) {}
      render(data);
    }).catch(function (err) {
      show("err", esc(err && err.message === "rate"
        ? L("查詢次數太多，請稍後再試。", "Too many attempts. Please try again later.")
        : L("暫時未能查詢，請稍後再試，或直接 WhatsApp 我們。", "We can't check right now. Please try again later, or WhatsApp us.")));
    }).then(function () {
      btn.disabled = false;
      btn.innerHTML = old;
    });
  });
})();
