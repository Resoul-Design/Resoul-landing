/* Resoul 紀念品店 — Shopify Storefront API 前端
 * 只讀公開 token，安全放前端；結帳交由 Shopify 托管。
 * 產品／價格／庫存全部由 Shopify 後台管理，改咗即刻反映，唔使改呢個檔。
 */
(function () {
  "use strict";

  /* ===== 語言（英文頁 <html lang="en"> 時出英文）===== */
  var EN = (document.documentElement.lang || "").slice(0, 2).toLowerCase() === "en";
  function L(zh, en) { return EN ? en : zh; }

  /* ===== 中英分離顯示 =====
   * 產品在 Shopify 以「中文 English（規格）」單一欄位儲存，
   * 這裡按頁面語言只顯示對應語言，令中文頁純中文、英文頁純英文。
   * 純前端處理，不改 Shopify 資料。
   */
  var CJK_RE = /[㐀-鿿豈-﫿぀-ヿ！-｠　-〿⺀-⻿]/g;
  // 單位／量詞字（唔當作英文名開始，令「7cm」「<18mm」「925」等跟返中文名，唔會拆到剩個孤零數字）
  var UNIT_WORDS = { cm:1, mm:1, kg:1, ml:1, cl:1, mg:1, hk:1, pcs:1, oz:1, ft:1, "in":1, set:1, box:1, can:1 };
  function cleanEdges(s) {
    s = String(s == null ? "" : s).replace(/\s+/g, " ");
    s = s.replace(/（\s*）/g, "").replace(/\(\s*\)/g, "");   // 去掉空括號
    return s.replace(/^[\s·・／/,、:：+\-]+|[\s·・／/,、:：+\-]+$/g, "").trim();
  }
  // 把「中文 English（規格）」拆成中／英兩個顯示名
  function splitLang(s) {
    s = String(s == null ? "" : s).trim();
    // 英文名開始 = 第一個「非單位」且長度≥2 嘅拉丁字（跳過 cm/mm/kg/HK… 等單位），
    // 令數字＋單位（7cm、<18mm、925）跟返中文名，唔會拆到剩返個孤零數字。
    var re = /[A-Za-z]{2,}/g, mm, idx = -1;
    while ((mm = re.exec(s))) {
      if (!UNIT_WORDS[mm[0].toLowerCase()]) { idx = mm.index; break; }
    }
    if (idx < 0) { var whole = cleanEdges(s); return { zh: whole, en: whole }; }
    var zh = cleanEdges(s.slice(0, idx)) || cleanEdges(s);
    var en = cleanEdges(s.slice(idx).replace(CJK_RE, " ")) || cleanEdges(s);
    return { zh: zh, en: en };
  }
  function pick(s) { var o = splitLang(s); return EN ? o.en : o.zh; }
  // 描述以段落分中英：<p>中文</p> … <p>English</p>
  function pickDesc(html) {
    if (!html) return "";
    var paras = [], re = /<(?:p|li)[^>]*>([\s\S]*?)<\/(?:p|li)>/gi, mm;
    while ((mm = re.exec(html))) {
      var t = mm[1].replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
      if (t) paras.push(t);
    }
    if (!paras.length) {
      return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    }
    var picked = paras.filter(function (t) {
      var cjk = (t.match(CJK_RE) || []).length, lat = (t.match(/[A-Za-z]/g) || []).length;
      return EN ? lat >= cjk : cjk >= lat;
    });
    if (!picked.length) picked = paras;
    return picked.join(" ");
  }
  // 類別 / 選項名稱：英文頁對照表（找不到就用原文）
  var LBL_EN = {
    "紙製品": "Paper Effigies", "骨灰甕": "Urns", "紀念品": "Keepsakes",
    "升級加購": "Add-ons", "紀念儀式用品": "Memorial Items", "火化服務": "Cremation Service",
    "紀念服務": "Memorial Service",
    "尺寸": "Size", "顏色": "Colour", "款式": "Style", "材質": "Material", "重量": "Weight",
    "排數": "Rows", "計費": "Billing"
  };
  function lbl(s) {
    var t = (s || "").trim();
    if (!EN) return splitLang(t).zh;          // 中文頁：取中文部分（含雙語類型）
    return LBL_EN[t] || splitLang(t).en;      // 英文頁：先查對照表，否則取英文部分
  }

  /* ===== 設定（公開只讀，安全）===== */
  var SHOP = {
    domain: "qs1nmv-b3.myshopify.com",
    token: "90f06d055534783ae5a7ad3f0f1e5004",
    version: "2026-01"
  };
  var ENDPOINT = "https://" + SHOP.domain + "/api/" + SHOP.version + "/graphql.json";
  var CART_KEY = "resoul-cart-id";

  /* ===== 訂製：客戶特別要求 + 上載寵物相片（存 Supabase，訂單附連結）===== */
  var SB_URL = "https://tkgxdzvsnmereaygddaz.supabase.co";
  var SB_KEY = "sb_publishable_bRZVm-air0obDK7QuRYaMw_b-mnVMA6";
  var UPLOAD_BUCKET = "custom-uploads";
  // 只有非「紙製品」（即訂製／紀念／服務類）先顯示訂製欄位
  // 是否顯示「特別要求 + 上載相片」。可用 Shopify 標籤逐件控制：
  //   加標籤「特別要求」／「custom」 → 強制開啟
  //   加標籤「無特別要求」／「no-custom」 → 強制關閉
  //   否則預設：非「紙製品」類別即開啟
  function isCustomizable(p) {
    var tags = (p.tags || []).map(function (t) { return String(t).trim().toLowerCase(); });
    if (tags.indexOf("無特別要求") >= 0 || tags.indexOf("no-custom") >= 0) return false;
    if (tags.indexOf("特別要求") >= 0 || tags.indexOf("custom") >= 0) return true;
    return (p.productType || "").indexOf("紙製品") < 0;
  }
  function uploadPhoto(file) {
    var ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    var path = "orders/" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + "." + ext;
    return fetch(SB_URL + "/storage/v1/object/" + UPLOAD_BUCKET + "/" + path, {
      method: "POST",
      headers: {
        apikey: SB_KEY,
        Authorization: "Bearer " + SB_KEY,
        "Content-Type": file.type || "application/octet-stream"
      },
      body: file
    }).then(function (r) {
      if (!r.ok) throw new Error("upload failed " + r.status);
      return SB_URL + "/storage/v1/object/public/" + UPLOAD_BUCKET + "/" + path;
    });
  }

  /* ===== 小工具 ===== */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function money(amount, code) {
    var n = Number(amount);
    try {
      return new Intl.NumberFormat("zh-HK", {
        style: "currency", currency: code || "HKD",
        minimumFractionDigits: (n % 1 === 0 ? 0 : 2), maximumFractionDigits: 2
      }).format(n);
    } catch (e) {
      return (code || "HKD") + " " + n.toLocaleString();
    }
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* ===== GraphQL ===== */
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

  /* ===== 產品查詢 ===== */
  var PRODUCTS_Q =
    "query($n:Int!){ products(first:$n, sortKey:CREATED_AT, reverse:true){ edges{ node{" +
    " id title descriptionHtml handle productType tags" +
    " featuredImage{ url altText }" +
    " images(first:6){ edges{ node{ url altText } } }" +
    " options{ name values }" +
    " priceRange{ minVariantPrice{ amount currencyCode } }" +
    " variants(first:100){ edges{ node{ id title availableForSale" +
    " price{ amount currencyCode } selectedOptions{ name value } image{ url altText } } } }" +
    " } } } }";

  /* ===== 購物車 mutations ===== */
  var CART_FIELDS =
    " id checkoutUrl totalQuantity" +
    " cost{ subtotalAmount{ amount currencyCode } }" +
    " lines(first:100){ edges{ node{ id quantity attributes{ key value }" +
    " merchandise{ ... on ProductVariant { id title image{ url altText }" +
    " price{ amount currencyCode } product{ title } selectedOptions{ name value } } } } } }";

  function line(merchandiseId, qty, attrs) {
    var l = { merchandiseId: merchandiseId, quantity: qty };
    if (attrs && attrs.length) l.attributes = attrs;
    return l;
  }
  function cartCreate(merchandiseId, qty, attrs) {
    var q = "mutation($lines:[CartLineInput!]){ cartCreate(input:{lines:$lines}){ cart{" + CART_FIELDS + "} userErrors{ message } } }";
    return gql(q, { lines: [line(merchandiseId, qty, attrs)] })
      .then(function (d) { return d.cartCreate.cart; });
  }
  function cartGet(id) {
    var q = "query($id:ID!){ cart(id:$id){" + CART_FIELDS + "} }";
    return gql(q, { id: id }).then(function (d) { return d.cart; });
  }
  function cartAdd(id, merchandiseId, qty, attrs) {
    var q = "mutation($id:ID!,$lines:[CartLineInput!]!){ cartLinesAdd(cartId:$id, lines:$lines){ cart{" + CART_FIELDS + "} userErrors{ message } } }";
    return gql(q, { id: id, lines: [line(merchandiseId, qty, attrs)] })
      .then(function (d) { return d.cartLinesAdd.cart; });
  }
  function cartUpdate(id, lineId, qty) {
    var q = "mutation($id:ID!,$lines:[CartLineUpdateInput!]!){ cartLinesUpdate(cartId:$id, lines:$lines){ cart{" + CART_FIELDS + "} userErrors{ message } } }";
    return gql(q, { id: id, lines: [{ id: lineId, quantity: qty }] })
      .then(function (d) { return d.cartLinesUpdate.cart; });
  }
  function cartRemove(id, lineId) {
    var q = "mutation($id:ID!,$ids:[ID!]!){ cartLinesRemove(cartId:$id, lineIds:$ids){ cart{" + CART_FIELDS + "} userErrors{ message } } }";
    return gql(q, { id: id, ids: [lineId] }).then(function (d) { return d.cartLinesRemove.cart; });
  }

  /* ===== 狀態 ===== */
  var state = { products: [], cart: null, current: null, qty: 1, sel: {}, filter: "all", req: "", photo: null };

  /* ===== 分類入口（關鍵字對應，客戶產品 productType／標籤／名稱含關鍵字即歸類）===== */
  var CAT_KEYS = {
    urn:    ["骨灰", "甕", "盅", "龕", "urn"],
    stone:  ["晶石", "琉璃", "stone", "crystal"],
    bronze: ["銅印", "銅", "bronze"],
    print:  ["掌印", "鼻印", "毛髮", "paw", "nose", "fur", "print"],
    jewel:  ["飾物", "頸鏈", "手鏈", "吊墜", "jewel", "necklace", "pendant", "bracelet"],
    gift:   ["禮物", "關懷", "gift", "care", "comfort"]
  };
  function matchCat(p, key) {
    var kws = CAT_KEYS[key]; if (!kws) return false;
    var hay = ((p.productType || "") + " " + (p.tags || []).join(" ") + " " + (p.title || "")).toLowerCase();
    return kws.some(function (k) { return hay.indexOf(k.toLowerCase()) >= 0; });
  }

  /* ===== 購物車：確保存在 ===== */
  function ensureCartThen(mid, qty, attrs) {
    var id = null;
    try { id = localStorage.getItem(CART_KEY); } catch (e) {}
    if (id) {
      return cartAdd(id, mid, qty, attrs).catch(function () {
        // 舊 cart 失效 → 重新建立
        return cartCreate(mid, qty, attrs).then(function (c) { saveCartId(c); return c; });
      });
    }
    return cartCreate(mid, qty, attrs).then(function (c) { saveCartId(c); return c; });
  }
  function saveCartId(cart) {
    try { if (cart && cart.id) localStorage.setItem(CART_KEY, cart.id); } catch (e) {}
  }

  /* ===== 渲染：類別篩選 chips（按產品實際 productType 動態生成）===== */
  function renderFilters() {
    var bar = $("#shopFilters");
    if (!bar) return;
    // 抽出實際存在嘅類別（去重、保留原有次序）
    var cats = [];
    state.products.forEach(function (p) {
      var t = (p.productType || "").trim();
      if (t && cats.indexOf(t) === -1) cats.push(t);
    });
    // 少於兩個類別就唔使顯示篩選（得一種，篩咗都無意義）
    if (cats.length < 2) { bar.style.display = "none"; return; }
    bar.style.display = "flex";
    bar.innerHTML = "";
    var defs = [{ key: "all", label: L("全部", "All") }].concat(cats.map(function (c) { return { key: c, label: lbl(c) }; }));
    defs.forEach(function (d) {
      var b = el("button", "shop-chip" + (state.filter === d.key ? " sel" : ""), esc(d.label));
      b.type = "button";
      b.addEventListener("click", function () {
        state.filter = d.key;
        renderFilters();
        renderGrid();
      });
      bar.appendChild(b);
    });
  }

  /* ===== 渲染：產品列表 ===== */
  function renderGrid() {
    var grid = $("#shopGrid");
    var empty = $("#shopEmpty");
    grid.innerHTML = "";
    if (!state.products.length) { empty.style.display = "block"; return; }
    var list = state.filter === "all"
      ? state.products
      : (CAT_KEYS[state.filter]
          ? state.products.filter(function (p) { return matchCat(p, state.filter); })
          : state.products.filter(function (p) { return (p.productType || "").trim() === state.filter; }));
    if (!list.length) {
      empty.textContent = L("此類別暫時沒有商品。", "No products in this category yet.");
      empty.style.display = "block";
      return;
    }
    empty.style.display = "none";
    list.forEach(function (p) {
      var img = p.featuredImage ? p.featuredImage.url : "";
      var name = pick(p.title);
      var alt = p.featuredImage ? (p.featuredImage.altText || name) : name;
      var price = p.priceRange.minVariantPrice;
      var multi = p.variants.length > 1;
      var card = el("div", "pcard");
      card.innerHTML =
        (img ? '<img class="pcard-img" src="' + esc(img) + '" alt="' + esc(alt) + '" loading="lazy">'
             : '<div class="pcard-img pcard-noimg" aria-hidden="true">🕊️</div>') +
        '<div class="pcard-body">' +
        '<div class="pcard-name">' + esc(name) + "</div>" +
        '<div class="pcard-desc">' + esc(pickDesc(p.descriptionHtml).slice(0, 60)) + "</div>" +
        '<div class="pcard-foot"><div class="price">' + (multi ? L("", "from ") : "") + money(price.amount, price.currencyCode) +
        (multi ? L(" <small>起</small>", "") : "") + "</div>" +
        '<button class="btn" type="button">' + L("查看", "View") + "</button></div></div>";
      card.addEventListener("click", function () { openDetail(p); });
      grid.appendChild(card);
    });
  }

  /* ===== 渲染：產品詳情 ===== */
  function variantMatch(p) {
    // 根據已揀選項搵對應 variant
    return p.variants.find(function (v) {
      return v.selectedOptions.every(function (o) { return state.sel[o.name] === o.value; });
    }) || p.variants[0];
  }
  function openDetail(p) {
    state.current = p; state.qty = 1; state.sel = {}; state.req = ""; state.photo = null;
    p.options.forEach(function (o) { state.sel[o.name] = o.values[0]; });

    var v = variantMatch(p);
    var imgs = p.images.length ? p.images : (p.featuredImage ? [p.featuredImage] : []);
    var d = $("#shopDetail");
    var optsHtml = "";
    // 只有真正有選項（唔係預設單一 "Title/Default Title"）先顯示
    var realOpts = p.options.filter(function (o) {
      return !(o.values.length === 1 && (o.values[0] === "Default Title" || o.name === "Title"));
    });
    realOpts.forEach(function (o) {
      optsHtml += '<div class="opt-label">' + esc(lbl(o.name)) + "</div><div class=\"opts\" data-opt=\"" + esc(o.name) + "\">";
      o.values.forEach(function (val) {
        optsHtml += '<button type="button" class="opt' + (state.sel[o.name] === val ? " sel" : "") +
          '" data-val="' + esc(val) + '">' + esc(pick(val)) + "</button>";
      });
      optsHtml += "</div>";
    });

    var custHtml = isCustomizable(p)
      ? '<div class="pdp-custom">' +
        '<div class="opt-label">' + L("特別要求（可選）", "Special requests (optional)") + "</div>" +
        '<textarea id="custReq" class="cust-req" rows="2" placeholder="' +
          esc(L("例如：刻字內容、顏色、尺寸或其他備註…", "e.g. engraving text, colour, size or other notes…")) + '"></textarea>' +
        '<div class="opt-label">' + L("上載寵物相片（可選）", "Upload pet photo (optional)") + "</div>" +
        '<label class="cust-file"><input type="file" id="custPhoto" accept="image/*" hidden>' +
        '<span class="cust-file-btn">' + L("選擇相片", "Choose photo") + "</span>" +
        '<span class="cust-file-name" id="custPhotoName">' + L("未選擇檔案", "No file chosen") + "</span></label>" +
        '<div class="cust-hint">' + L("相片會連同訂單傳送給我們，方便訂製。", "Your photo is sent to us with the order to help with customization.") + "</div>" +
        "</div>"
      : "";

    d.innerHTML =
      '<button class="detail-back" type="button" id="detailBack">← ' + L("返回所有紀念品", "Back to all keepsakes") + "</button>" +
      '<div class="pdp">' +
      '<div class="pdp-media">' +
      (imgs.length ? '<img id="pdpImg" src="' + esc(imgs[0].url) + '" alt="' + esc(imgs[0].altText || pick(p.title)) + '">'
                   : '<div class="pdp-noimg">🕊️</div>') +
      (imgs.length > 1 ? '<div class="pdp-thumbs">' + imgs.map(function (im) {
        return '<img src="' + esc(im.url) + '" alt="" data-src="' + esc(im.url) + '">';
      }).join("") + "</div>" : "") +
      "</div>" +
      '<div class="pdp-info">' +
      '<h1 class="pdp-name">' + esc(pick(p.title)) + "</h1>" +
      '<div class="pdp-price" id="pdpPrice">' + money(v.price.amount, v.price.currencyCode) + "</div>" +
      '<div class="pdp-avail" id="pdpAvail"></div>' +
      optsHtml +
      '<div class="opt-label">' + L("數量", "Quantity") + "</div>" +
      '<div class="qty"><button type="button" data-q="-1">−</button><span id="pdpQ">1</span><button type="button" data-q="1">+</button></div>' +
      custHtml +
      '<div class="pdp-cta"><button class="btn lg" type="button" id="addBtn">' + L("加入購物車", "Add to cart") + "</button>" +
      '<button class="btn lg ghost" type="button" id="buyBtn">' + L("立即結帳", "Buy now") + "</button></div>" +
      (pickDesc(p.descriptionHtml) ? '<div class="pdp-desc">' + esc(pickDesc(p.descriptionHtml)) + "</div>" : "") +
      '<div class="trust">' +
      "<div><b>🕊️ " + L("專人跟進</b>　由具善終經驗的團隊，全程溫柔處理", "Personal care</b>　handled gently throughout by an experienced farewell team") + "</div>" +
      "<div><b>🔒 " + L("安全結帳</b>　付款透過安全結帳頁處理，資料受保護", "Secure checkout</b>　payment handled through a protected checkout") + "</div>" +
      "</div>" +
      "</div></div>";

    // 事件
    $("#detailBack").addEventListener("click", closeDetail);
    d.querySelectorAll(".pdp-thumbs img").forEach(function (t) {
      t.addEventListener("click", function () { $("#pdpImg").src = t.getAttribute("data-src"); });
    });
    d.querySelectorAll(".opts").forEach(function (g) {
      g.addEventListener("click", function (e) {
        var b = e.target.closest(".opt"); if (!b) return;
        var name = g.getAttribute("data-opt");
        state.sel[name] = b.getAttribute("data-val");
        g.querySelectorAll(".opt").forEach(function (o) { o.classList.toggle("sel", o === b); });
        refreshVariant();
      });
    });
    d.querySelectorAll(".qty button").forEach(function (b) {
      b.addEventListener("click", function () {
        state.qty = Math.max(1, state.qty + parseInt(b.getAttribute("data-q"), 10));
        $("#pdpQ").textContent = state.qty;
      });
    });
    var reqEl = $("#custReq");
    if (reqEl) reqEl.addEventListener("input", function () { state.req = reqEl.value; });
    var photoEl = $("#custPhoto");
    if (photoEl) photoEl.addEventListener("change", function () {
      state.photo = photoEl.files && photoEl.files[0] ? photoEl.files[0] : null;
      var nm = $("#custPhotoName");
      if (nm) nm.textContent = state.photo ? state.photo.name : L("未選擇檔案", "No file chosen");
    });

    $("#addBtn").addEventListener("click", function () { addCurrent(false); });
    $("#buyBtn").addEventListener("click", function () { addCurrent(true); });

    refreshVariant();
    $("#shopList").style.display = "none";
    var hd = document.querySelector(".shop-buy-hd"); if (hd) hd.style.display = "none";
    d.style.display = "block";
    scrollToShop();
  }
  function scrollToShop() {
    var target = document.querySelector(".shop-wrap");
    if (!target) return;
    var header = document.querySelector(".site-header");
    var offset = (header ? header.offsetHeight : 0) + 14;
    var y = target.getBoundingClientRect().top + window.pageYOffset - offset;
    window.scrollTo({ top: y < 0 ? 0 : y, behavior: "smooth" });
  }
  function refreshVariant() {
    var p = state.current; if (!p) return;
    var v = variantMatch(p);
    $("#pdpPrice").textContent = money(v.price.amount, v.price.currencyCode);
    var av = $("#pdpAvail"), add = $("#addBtn"), buy = $("#buyBtn");
    if (v.image) $("#pdpImg").src = v.image.url;
    if (v.availableForSale) {
      av.textContent = ""; av.className = "pdp-avail";
      if (add) { add.disabled = false; buy.disabled = false; }
    } else {
      av.textContent = L("此選項暫時缺貨", "This option is out of stock"); av.className = "pdp-avail out";
      if (add) { add.disabled = true; buy.disabled = true; }
    }
  }
  function closeDetail() {
    $("#shopDetail").style.display = "none";
    var hd = document.querySelector(".shop-buy-hd"); if (hd) hd.style.display = "";
    $("#shopList").style.display = "block";
    state.current = null;
    scrollToShop();
  }

  /* ===== 加入購物車 ===== */
  function addCurrent(checkout) {
    var p = state.current; if (!p) return;
    var v = variantMatch(p);
    if (!v || !v.availableForSale) { toast(L("此選項暫時缺貨", "This option is out of stock")); return; }
    var btns = [$("#addBtn"), $("#buyBtn")];
    btns.forEach(function (b) { if (b) b.disabled = true; });
    var req = (state.req || "").trim();
    var photo = state.photo;
    var prep = photo
      ? (toast(L("正在上載相片…", "Uploading photo…")), uploadPhoto(photo))
      : Promise.resolve(null);
    prep.then(function (photoUrl) {
      var attrs = [];
      if (req) attrs.push({ key: "特別要求 Special request", value: req });
      if (photoUrl) attrs.push({ key: "寵物相片 Pet photo", value: photoUrl });
      return ensureCartThen(v.id, state.qty, attrs);
    }).then(function (cart) {
      state.cart = cart; saveCartId(cart); renderCart();
      if (checkout) {
        if (cart.checkoutUrl) window.location.href = cart.checkoutUrl;
      } else {
        toast(L("已加入購物車", "Added to cart")); openCart();
      }
    }).catch(function (err) {
      toast(photo ? L("相片上載失敗，請換張相或稍後再試", "Photo upload failed, try another photo or later")
                  : L("加入失敗，請稍後再試", "Couldn't add, please try again"));
      console.error("cart add error:", err);
    }).then(function () {
      btns.forEach(function (b) { if (b) b.disabled = false; });
    });
  }

  /* ===== 渲染：購物車 ===== */
  function renderCart() {
    var cart = state.cart;
    var n = cart ? cart.totalQuantity : 0;
    var cc = $("#cartCount");
    cc.textContent = n; cc.style.display = n ? "flex" : "none";
    var body = $("#cartBody");
    var lines = cart && cart.lines ? cart.lines.edges.map(function (e) { return e.node; }) : [];
    if (!lines.length) {
      body.innerHTML = '<div class="cart-empty">' + L("購物車暫時是空的。<br>慢慢看，不急。", "Your cart is empty for now.<br>Take your time.") + "</div>";
      $("#cartSub").textContent = money(0, "HKD");
      return;
    }
    body.innerHTML = "";
    lines.forEach(function (ln) {
      var m = ln.merchandise;
      var opt = (m.selectedOptions || []).filter(function (o) {
        return o.value !== "Default Title";
      }).map(function (o) { return pick(o.value); }).join(" · ");
      var img = m.image ? m.image.url : "";
      var attrs = ln.attributes || [];
      var reqA = attrs.filter(function (a) { return a.key.indexOf("特別要求") === 0; })[0];
      var photoA = attrs.filter(function (a) { return a.key.indexOf("寵物相片") === 0; })[0];
      var custHtml =
        (reqA && reqA.value ? '<div class="line-cust">✎ ' + esc(reqA.value) + "</div>" : "") +
        (photoA && photoA.value ? '<div class="line-cust"><a href="' + esc(photoA.value) + '" target="_blank" rel="noopener">🖼 ' + L("已附相片", "Photo attached") + "</a></div>" : "");
      var line = el("div", "line");
      line.innerHTML =
        (img ? '<img src="' + esc(img) + '" alt="">' : '<div class="line-noimg">🕊️</div>') +
        '<div class="line-info">' +
        '<div class="line-name">' + esc(pick(m.product.title)) + "</div>" +
        (opt ? '<div class="line-opt">' + esc(opt) + "</div>" : "") +
        custHtml +
        '<div class="line-row"><span class="line-qty">' +
        '<button type="button" data-a="-1">−</button><span>' + ln.quantity + "</span>" +
        '<button type="button" data-a="1">+</button></span>' +
        '<span class="line-price">' + money(m.price.amount * ln.quantity, m.price.currencyCode) + "</span></div>" +
        '<button class="line-rm" type="button">' + L("移除", "Remove") + "</button></div>";
      line.querySelectorAll(".line-qty button").forEach(function (b) {
        b.addEventListener("click", function () {
          var q = ln.quantity + parseInt(b.getAttribute("data-a"), 10);
          changeLine(ln.id, q);
        });
      });
      line.querySelector(".line-rm").addEventListener("click", function () { changeLine(ln.id, 0); });
      body.appendChild(line);
    });
    var sub = cart.cost.subtotalAmount;
    $("#cartSub").textContent = money(sub.amount, sub.currencyCode);
  }
  function changeLine(lineId, qty) {
    var id = state.cart.id;
    var p = qty <= 0 ? cartRemove(id, lineId) : cartUpdate(id, lineId, qty);
    p.then(function (cart) { state.cart = cart; renderCart(); })
     .catch(function (err) { console.error("cart update error:", err); });
  }

  /* ===== 抽屜／提示 ===== */
  function openCart() { $("#cart").classList.add("open"); $("#shopOverlay").classList.add("open"); document.body.classList.add("cart-open"); }
  function closeCart() { $("#cart").classList.remove("open"); $("#shopOverlay").classList.remove("open"); document.body.classList.remove("cart-open"); }
  var toastTimer;
  function toast(msg) {
    var t = $("#shopToast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 1600);
  }

  /* ===== 結帳 ===== */
  function checkout() {
    if (state.cart && state.cart.checkoutUrl) {
      window.location.href = state.cart.checkoutUrl;
    } else {
      toast(L("購物車是空的", "Your cart is empty"));
    }
  }

  /* ===== 啟動 ===== */
  function init() {
    $("#cartBtn").addEventListener("click", openCart);
    $("#cartClose").addEventListener("click", closeCart);
    $("#shopOverlay").addEventListener("click", closeCart);
    $("#checkoutBtn").addEventListener("click", checkout);

    // 對外 hook：分類入口設定篩選（見 shop.html 分類卡）
    window.ResoulShop = {
      setFilter: function (t) {
        // 若正在看產品詳情，先返回列表
        if (state.current) closeDetail();
        state.filter = t || "all";
        renderFilters();
        renderGrid();
      }
    };

    // 載入產品
    gql(PRODUCTS_Q, { n: 250 }).then(function (data) {
      state.products = data.products.edges.map(function (e) {
        var n = e.node;
        n.images = n.images.edges.map(function (x) { return x.node; });
        n.variants = n.variants.edges.map(function (x) { return x.node; });
        return n;
      });
      renderFilters();
      renderGrid();
      $("#shopLoading").style.display = "none";
    }).catch(function (err) {
      $("#shopLoading").style.display = "none";
      $("#shopError").style.display = "block";
      console.error("products load error:", err);
    });

    // 還原已存在的購物車
    var id = null;
    try { id = localStorage.getItem(CART_KEY); } catch (e) {}
    if (id) {
      cartGet(id).then(function (cart) {
        if (cart) { state.cart = cart; renderCart(); }
        else { try { localStorage.removeItem(CART_KEY); } catch (e) {} }
      }).catch(function () {});
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else { init(); }
})();
