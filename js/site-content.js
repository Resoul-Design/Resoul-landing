/* 後台「網站內容」：讀取 /api/site-content，替換頁面上標記 data-cms 的區塊。
   HTML 保留預設內容；讀取失敗或後台未儲存時，頁面維持原狀。 */
(function () {
  "use strict";

  var EN = (document.documentElement.lang || "").toLowerCase().indexOf("en") === 0;
  function L(zh, en) { return EN ? en : zh; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function money(n) { return Number(n).toLocaleString("en-US"); }
  function isNum(n) { return typeof n === "number" && isFinite(n); }
  function arr(v) { return Array.isArray(v) ? v : []; }
  // 段落：空行分段，單一換行轉 <br>
  function paras(text) {
    return String(text || "").split(/\n\s*\n/).map(function (p) { return p.trim(); }).filter(Boolean)
      .map(function (p) { return "<p>" + esc(p).replace(/\n/g, "<br>") + "</p>"; }).join("");
  }
  function safeLink(url) {
    url = String(url || "").trim();
    return /^(https?:\/\/|\/)/i.test(url) && !/^\/\//.test(url) ? url : "";
  }

  var renderers = {
    // 火化收費（按體重）＋「參考價格」起價列
    "prices.cremation": function (data) {
      var rows = arr(data.rows).filter(function (r) { return r && arr(r.prices).length === 3; });
      if (!rows.length) return;
      document.querySelectorAll('[data-cms="prices.cremation"]').forEach(function (tb) {
        tb.innerHTML = rows.map(function (r) {
          return "<tr><td>" + esc(L(r.zh, r.en)) + "</td>" + r.prices.map(function (p) {
            return "<td>" + (isNum(p) ? "HK$" + money(p) : "—") + "</td>";
          }).join("") + "</tr>";
        }).join("");
      });
      var from = [0, 1, 2].map(function (i) {
        var vals = rows.map(function (r) { return r.prices[i]; }).filter(isNum);
        return vals.length ? Math.min.apply(null, vals) : null;
      });
      document.querySelectorAll('[data-cms="prices.cremation.from"]').forEach(function (tr) {
        var cells = tr.querySelectorAll("td");
        from.forEach(function (v, i) {
          if (cells[i + 1] && v != null) cells[i + 1].textContent = L("HK$" + money(v) + " 起", "HK$" + money(v));
        });
      });
    },

    // 上門安樂死收費（日間／晚間範圍；留空＝個別報價）
    "prices.vet": function (data) {
      var rows = arr(data.rows);
      if (!rows.length) return;
      function range(a, b) {
        if (!isNum(a)) return esc(L("個別報價", "Quoted individually"));
        return "HK$" + money(a) + (isNum(b) && b !== a ? " – " + money(b) : "");
      }
      document.querySelectorAll('[data-cms="prices.vet"]').forEach(function (tb) {
        tb.innerHTML = rows.map(function (r) {
          return "<tr><td>" + esc(L(r.zh, r.en)) + "</td><td>" + range(r.dayFrom, r.dayTo) + "</td><td>" + range(r.nightFrom, r.nightTo) + "</td></tr>";
        }).join("");
      });
    },

    // 情緒支援收費
    "prices.grief": function (data) {
      var rows = arr(data.rows);
      if (!rows.length) return;
      document.querySelectorAll('[data-cms="prices.grief"]').forEach(function (tb) {
        tb.innerHTML = rows.map(function (r) {
          return "<tr><td>" + esc(L(r.zh, r.en)) + "</td><td>" + esc(L(r.priceZh, r.priceEn)) + "</td></tr>";
        }).join("");
      });
    },

    // 火化頁紀念精品
    "keepsakes": function (data) {
      var items = arr(data.items);
      if (!items.length) return;
      document.querySelectorAll('[data-cms="keepsakes"]').forEach(function (grid) {
        grid.innerHTML = items.map(function (it) {
          return '<div class="scard"><span class="sc-ic" aria-hidden="true">' + esc(it.icon) + "</span><h3>" + esc(L(it.zh, it.en)) + "</h3><p>" + esc(L(it.descZh, it.descEn)) + "</p></div>";
        }).join("");
      });
    },

    // 商店分類卡（data-types／data-tags／data-keywords 交 js/shop.js 篩選）
    "shop.categories": function (data) {
      var items = arr(data.items).filter(function (it) { return it && it.key; });
      if (!items.length) return;
      document.querySelectorAll('[data-cms="shop.categories"]').forEach(function (grid) {
        grid.innerHTML = items.map(function (it) {
          var list = function (v) { return esc(arr(v).join("|")); };
          return '<a class="cat-card" href="#shopList" data-cat="' + esc(it.key) + '" data-types="' + list(it.types) + '" data-tags="' + list(it.tags) + '" data-keywords="' + list(it.keywords) + '">' +
            (it.img ? '<img decoding="async" class="cat-bg" src="' + esc(it.img) + '" alt="" loading="lazy">' : "") +
            '<span class="cat-veil" aria-hidden="true"></span><span class="sc-ic" aria-hidden="true">' + esc(it.icon) + "</span><h3>" +
            esc(L(it.zh, it.en)) + "</h3><p>" + esc(L(it.descZh, it.descEn)) + "</p></a>";
        }).join("");
        grid.querySelectorAll("img.cat-bg").forEach(function (img) {
          img.addEventListener("error", function () { img.style.display = "none"; });
        });
      });
    },

    // 頁頂公告
    "notice": function (data) {
      var text = String(L(data.zh, data.en) || "").trim();
      if (!data.enabled || !text) return;
      var link = safeLink(data.link);
      var bar = document.createElement("div");
      bar.className = "site-notice";
      bar.setAttribute("role", "status");
      bar.innerHTML = link
        ? '<a href="' + esc(link) + '"' + (/^https?:/i.test(link) ? ' target="_blank" rel="noopener"' : "") + ">" + esc(text) + ' <span aria-hidden="true">→</span></a>'
        : esc(text);
      document.body.insertBefore(bar, document.body.firstChild);
    }
  };

  // 常見問題（火化／預約接送、上門安樂死、情緒支援）
  function faqItem(it) {
    return '<div class="faq2-item"><button class="faq2-q" type="button" aria-expanded="false"><span class="faq2-ic" aria-hidden="true">＋</span><span class="faq2-qt">' +
      esc(L(it.qZh, it.qEn)) + '</span></button><div class="faq2-a">' + paras(L(it.aZh, it.aEn)) + "</div></div>";
  }
  function validItems(g) {
    return arr(g.items).filter(function (it) { return it && String(L(it.qZh, it.qEn) || "").trim(); });
  }
  function renderFaq(key, data) {
    var groups = arr(data.groups).filter(function (g) { return g && validItems(g).length; });
    if (!groups.length) return;
    document.querySelectorAll('[data-cms="' + key + '"]').forEach(function (box) {
      if (box.classList.contains("mood-groups")) {
        // 情緒支援：分組對應頁面上方的心情篩選掣（data-g 1–4）
        box.innerHTML = groups.map(function (g, i) {
          return '<div class="mood-group" data-g="' + (i + 1) + '"><h3 class="mg-title"><span class="mg-ic" aria-hidden="true">' + esc(g.icon) + "</span> " +
            esc(L(g.zh, g.en)) + '</h3><div class="faq2">' + validItems(g).map(faqItem).join("") + "</div></div>";
        }).join("");
        var active = document.querySelector(".mood-filter .mf-chip.active");
        var sel = active ? active.getAttribute("data-g") : "all";
        box.querySelectorAll(".mood-group").forEach(function (grp) { grp.classList.toggle("hidden", sel !== "all" && grp.getAttribute("data-g") !== sel); });
      } else {
        box.innerHTML = groups.map(function (g) {
          return '<div class="faq-group reveal in"><h3 class="faq-group-title">' + esc(L(g.zh, g.en)) + '</h3><div class="faq2">' + validItems(g).map(faqItem).join("") + "</div></div>";
        }).join("");
      }
    });
  }
  ["faq.cremation", "faq.euthanasia", "faq.support"].forEach(function (k) {
    renderers[k] = function (data) { renderFaq(k, data); };
  });

  function run() {
    var keys = ["notice"];
    document.querySelectorAll("[data-cms]").forEach(function (n) {
      var k = n.getAttribute("data-cms").replace(/\.from$/, "");
      if (renderers[k] && keys.indexOf(k) < 0) keys.push(k);
    });
    fetch("/api/site-content?keys=" + encodeURIComponent(keys.join(",")))
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (content) {
        keys.forEach(function (k) {
          if (content && content[k] && typeof content[k] === "object") {
            try { renderers[k](content[k]); } catch (e) { /* 單一區塊出錯不影響其他區塊 */ }
          }
        });
      })
      .catch(function () { /* 維持 HTML 預設內容 */ });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
})();
