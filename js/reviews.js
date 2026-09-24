/* RESOUL — Google Reviews 渲染器
 * 讀取 js/reviews-data.js 的 window.RESOUL_REVIEWS，填入任何
 * [data-google-reviews] 容器。可用屬性：
 *   data-limit="6"   只顯示前 N 則（不填＝全部）
 * 每則支援可選相片（photo 欄）。與「主人故事分享」分開，並標明來源為 Google。
 */
(function () {
  "use strict";
  var EN = (document.documentElement.lang || "").slice(0, 2).toLowerCase() === "en";
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function stars(n) {
    n = Math.max(0, Math.min(5, parseInt(n, 10) || 5));
    return new Array(n + 1).join("★") + new Array(6 - n).join("☆");
  }
  function srcLabel() { return EN ? "Google review" : "Google 評價"; }

  function card(r) {
    var quote = EN ? (r.en || r.zh || "") : (r.zh || r.en || "");
    var name = esc(r.name || (EN ? "A pet parent" : "一位主人"));
    var photoUrl = /^(https?:\/\/|\/|images\/)/i.test(String(r.photo || "")) ? r.photo : "";
    var photo = photoUrl
      ? '<img class="rc-img" src="' + esc(photoUrl) + '" alt="' + name + '" loading="lazy" onerror="this.remove()">'
      : "";
    var sourceUrl = /^(https?:\/\/)/i.test(String(r.sourceUrl || "")) ? r.sourceUrl : "";
    var source = sourceUrl
      ? '<a href="' + esc(sourceUrl) + '" target="_blank" rel="noopener noreferrer">' + srcLabel() + " ↗</a>"
      : srcLabel();
    return '<figure class="rcard">' +
      photo +
      '<div class="rc-top">' +
        '<div class="rc-photo" aria-hidden="true">🐾</div>' +
        '<div class="rc-meta"><div class="rc-name">' + name + "</div>" +
          '<div class="rc-stars" aria-label="' + (parseInt(r.rating, 10) || 5) + (EN ? " star review" : " 星評價") + '">' + stars(r.rating) + "</div></div>" +
      "</div>" +
      '<blockquote class="rc-quote">「' + esc(quote) + "」</blockquote>" +
      '<figcaption class="rc-src"><span class="rc-g">G</span> ' + source + "</figcaption>" +
      "</figure>";
  }

  function render(host, reviews) {
    var data = Array.isArray(reviews) ? reviews.slice() : [];
    var lim = parseInt(host.getAttribute("data-limit"), 10);
    if (lim > 0) data = data.slice(0, lim);
    if (!data.length) {
      host.innerHTML = '<div class="reviews-empty">' +
        (EN ? "Reviews will appear here soon." : "評價將陸續在此顯示。") + "</div>";
      return;
    }
    host.innerHTML = data.map(card).join("");
  }

  var hosts = document.querySelectorAll("[data-google-reviews]");
  var fallback = Array.isArray(window.RESOUL_REVIEWS) ? window.RESOUL_REVIEWS.slice() : [];
  fetch("/api/google-reviews", { headers: { accept: "application/json" }, cache: "no-store" })
    .then(function (response) {
      if (!response.ok) throw new Error("reviews_unavailable");
      return response.json();
    })
    .then(function (reviews) {
      hosts.forEach(function (host) { render(host, reviews); });
    })
    .catch(function () {
      hosts.forEach(function (host) { render(host, fallback); });
    });
})();
