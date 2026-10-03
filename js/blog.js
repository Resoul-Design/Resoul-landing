/* Resoul 照顧誌 — Shopify Blog（Storefront API）
 * 獸醫喺 Shopify 後台寫文章，呢度自動拉落嚟，唔使改 code。
 * 需要 Storefront app 權限：unauthenticated_read_content
 */
(function () {
  "use strict";

  var EN = (document.documentElement.lang || "").slice(0, 2).toLowerCase() === "en";
  function L(zh, en) { return EN ? en : zh; }

  var SHOP = {
    domain: "qs1nmv-b3.myshopify.com",
    token: "90f06d055534783ae5a7ad3f0f1e5004",
    version: "2026-01"
  };
  var ENDPOINT = "https://" + SHOP.domain + "/api/" + SHOP.version + "/graphql.json";

  /* 留言由 Supabase 保存（見 supabase/schema.sql）；publishable key 為公開用途 */
  var SB_URL = "https://diyxcxkgvqvyrstrzttq.supabase.co";
  var SB_KEY = "sb_publishable_pQm9mD7UikuzkhRhMQr3Mw_JxA-1R8K";
  var SBH = { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY };
  function sbCrisis(t) { return /想死|唔想活|自殺|傷害自己|撐唔住|頂唔住|想跟(佢|牠|你)去|活唔落去|結束生命|唔想生存|冇晒意思/.test(t); }
  function loadComments(handle, listEl, countEl) {
    fetch(SB_URL + "/rest/v1/posts?select=name,body,created_at&status=eq.visible&context=eq." + encodeURIComponent("blog:" + handle) + "&order=created_at.desc&limit=100", { headers: SBH })
      .then(function (r) { return r.json(); })
      .then(function (rows) {
        if (!Array.isArray(rows)) return;
        if (countEl) countEl.textContent = rows.length;
        if (!rows.length) { listEl.innerHTML = '<p class="comments-empty">' + L("還沒有留言。願意的話，成為第一個留言的人。", "No comments yet. If you'd like, be the first to leave one.") + "</p>"; return; }
        listEl.innerHTML = rows.map(function (c) {
          return '<div class="comment"><div class="comment-author">' + esc(c.name || L("一位讀者", "A reader")) + "</div>" +
                 '<div class="comment-body">' + esc(c.body || "").replace(/\n/g, "<br>") + "</div></div>";
        }).join("");
      }).catch(function () {});
  }

  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function fmtDate(iso) {
    if (!iso) return "";
    try {
      return new Intl.DateTimeFormat(EN ? "en-GB" : "zh-HK", { year: "numeric", month: "long", day: "numeric" }).format(new Date(iso));
    } catch (e) { return iso.slice(0, 10); }
  }

  function gql(query, variables) {
    return fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Storefront-Access-Token": SHOP.token
      },
      body: JSON.stringify({ query: query, variables: variables || {} })
    }).then(function (r) { return r.json(); }).then(function (res) {
      if (res.errors && res.errors.length) {
        throw new Error(res.errors.map(function (e) { return e.message; }).join("; "));
      }
      return res.data;
    });
  }

  var ARTICLES_Q =
    "query($n:Int!){ articles(first:$n, sortKey:PUBLISHED_AT, reverse:true){ edges{ node{" +
    " id handle title excerpt publishedAt contentHtml tags" +
    " image{ url altText } authorV2{ name } blog{ title handle }" +
    " } } } }";

  // 語言區分：英文文章在 Shopify 後台加上標籤「en」；
  // 英文版只顯示帶「en」標籤的文章，中文版顯示其餘（未標「en」）文章。
  function isEnArticle(a) {
    return (a.tags || []).some(function (t) { return String(t).trim().toLowerCase() === "en"; });
  }
  function matchesLang(a) { return EN ? isEnArticle(a) : !isEnArticle(a); }

  // 分類：由後台「文章記錄 → 文章分類」管理（Supabase blog_categories，只讀已啟用的分類）；
  // Shopify 文章加上與中文名稱相同的標籤（Tags），網誌頁即顯示對應篩選掣；中英文文章共用中文標籤。
  // 讀取失敗或未設定時，使用以下預設分類。
  var CATEGORIES = [
    { tag: "突發應急與善終指南", en: "Emergency & farewell guide" },
    { tag: "服務流程與方案選擇", en: "Process & plans" },
    { tag: "永恆紀念與骨灰飾物", en: "Keepsakes & ashes jewellery" },
    { tag: "心靈陪伴與哀傷輔導", en: "Grief support & counselling" }
  ];
  function loadCategories() {
    return fetch(SB_URL + "/rest/v1/blog_categories?select=tag,label_en&is_active=eq.true&order=sort_order.asc,created_at.asc", { headers: SBH })
      .then(function (r) { if (!r.ok) throw new Error("categories"); return r.json(); })
      .then(function (rows) {
        if (!Array.isArray(rows) || !rows.length) return;
        CATEGORIES = rows.filter(function (c) { return c && c.tag; }).map(function (c) { return { tag: String(c.tag).trim(), en: c.label_en || c.tag }; });
      })
      .catch(function () {});
  }
  function hasTag(a, tag) {
    return (a.tags || []).some(function (t) { return String(t).trim() === tag; });
  }
  var state = { articles: [], filter: "all" };

  function renderFilter() {
    var list = $("#blogList");
    var bar = $("#blogFilter");
    var used = CATEGORIES.filter(function (c) { return state.articles.some(function (a) { return hasTag(a, c.tag); }); });
    if (!used.length) { if (bar) bar.remove(); return; }
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "blogFilter";
      bar.className = "blog-filter";
      bar.setAttribute("role", "group");
      bar.setAttribute("aria-label", L("按分類篩選文章", "Filter articles by category"));
      list.insertBefore(bar, $("#blogGrid"));
    }
    var items = [{ key: "all", label: L("全部", "All") }].concat(used.map(function (c) { return { key: c.tag, label: L(c.tag, c.en) }; }));
    bar.innerHTML = items.map(function (it) {
      return '<button type="button" data-cat="' + esc(it.key) + '" aria-pressed="' + (state.filter === it.key ? "true" : "false") + '">' + esc(it.label) + "</button>";
    }).join("");
    bar.querySelectorAll("button").forEach(function (b) {
      b.addEventListener("click", function () {
        state.filter = b.getAttribute("data-cat");
        renderFilter();
        renderList();
      });
    });
  }

  function renderList() {
    var grid = $("#blogGrid");
    var empty = $("#blogEmpty");
    grid.innerHTML = "";
    if (!state.articles.length) {
      // fallback：缺對應語言文章時明確顯示（英文版：暫無英文文章）
      if (empty) { empty.textContent = L("文章即將刊登，請稍後再來看看。", "No English articles yet — please check back later."); empty.style.display = "block"; }
      return;
    }
    empty.style.display = "none";
    state.articles.filter(function (a) { return state.filter === "all" || hasTag(a, state.filter); }).forEach(function (a) {
      var img = a.image ? a.image.url : "";
      var alt = a.image ? (a.image.altText || a.title) : a.title;
      var author = a.authorV2 ? a.authorV2.name : "";
      var meta = [author, fmtDate(a.publishedAt)].filter(Boolean).join("　·　");
      var card = document.createElement("article");
      card.className = "bcard";
      card.innerHTML =
        (img ? '<img class="bcard-img" src="' + esc(img) + '" alt="' + esc(alt) + '" loading="lazy">'
             : '<div class="bcard-img bcard-noimg" aria-hidden="true">🐾</div>') +
        '<div class="bcard-body">' +
        '<div class="bcard-title">' + esc(a.title) + "</div>" +
        (meta ? '<div class="bcard-meta">' + esc(meta) + "</div>" : "") +
        '<div class="bcard-excerpt">' + esc((a.excerpt || "").slice(0, 90)) + "</div>" +
        '<span class="bcard-more">' + L("閱讀全文", "Read more") + " →</span>" +
        "</div>";
      card.addEventListener("click", function () { openArticle(a); });
      grid.appendChild(card);
    });
  }

  function openArticle(a) {
    var d = $("#blogArticle");
    var img = a.image ? a.image.url : "";
    var author = a.authorV2 ? a.authorV2.name : "";
    var meta = [author, fmtDate(a.publishedAt)].filter(Boolean).join("　·　");
    var handle = a.handle;
    d.innerHTML =
      '<button class="detail-back" type="button" id="articleBack">← ' + L("返回所有文章", "Back to all articles") + "</button>" +
      '<article class="article">' +
      '<h1 class="article-title">' + esc(a.title) + "</h1>" +
      (meta ? '<p class="article-meta">' + esc(meta) + "</p>" : "") +
      (img ? '<img class="article-cover" src="' + esc(img) + '" alt="' + esc(a.image.altText || a.title) + '">' : "") +
      '<div class="article-body">' + (a.contentHtml || "") + "</div>" +
      '<p class="article-note">' + L("本文僅供一般參考，個別情況請諮詢你的獸醫。", "This article is for general reference only; please consult your vet for individual cases.") + "</p>" +
      "</article>";
    $("#articleBack").addEventListener("click", closeArticle);
    $("#blogList").style.display = "none";
    d.style.display = "block";
    scrollToBlog();
  }
  function closeArticle() {
    $("#blogArticle").style.display = "none";
    $("#blogList").style.display = "block";
    scrollToBlog();
  }
  function scrollToBlog() {
    var target = document.querySelector(".blog-wrap");
    if (!target) return;
    var header = document.querySelector(".site-header");
    var offset = (header ? header.offsetHeight : 0) + 14;
    var y = target.getBoundingClientRect().top + window.pageYOffset - offset;
    window.scrollTo({ top: y < 0 ? 0 : y, behavior: "smooth" });
  }

  function init() {
    Promise.all([gql(ARTICLES_Q, { n: 50 }), loadCategories()]).then(function (res) {
      var data = res[0];
      state.articles = data.articles.edges.map(function (e) { return e.node; }).filter(matchesLang);
      renderFilter();
      renderList();
      $("#blogLoading").style.display = "none";
    }).catch(function (err) {
      $("#blogLoading").style.display = "none";
      $("#blogError").style.display = "block";
      console.error("articles load error:", err);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
