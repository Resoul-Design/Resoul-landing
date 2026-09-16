/* 分享頁 / Remember Their Story — 紀念故事（Supabase）
 * 沿用 public.posts（context='memorial'），欄位見 supabase/memorial_stories.sql
 * 功能：提交（公開／只限連結）、預先審核、留下心意（RPC）、連結分享、AI 草擬
 */
(function () {
  "use strict";
  var EN = (document.documentElement.lang || "").slice(0, 2).toLowerCase() === "en";
  function L(zh, en) { return EN ? en : zh; }
  var SB_URL = "https://diyxcxkgvqvyrstrzttq.supabase.co";
  var SB_KEY = "sb_publishable_pQm9mD7UikuzkhRhMQr3Mw_JxA-1R8K";
  var H = { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY };

  var list = document.getElementById("boardList");
  if (!list) return;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function crisis(t) {
    return /想死|唔想活|自殺|傷害自己|撐唔住|頂唔住|想跟(佢|牠|你)去|活唔落去|結束生命|唔想生存|冇晒意思/.test(t || "");
  }
  function pubUrl(path) { return SB_URL + "/storage/v1/object/public/board-images/" + path; }
  function heartedKey(id) { return "resoul-heart-" + id; }

  /* ---------- 渲染紀念卡 ---------- */
  function card(p) {
    var el = document.createElement("div");
    el.className = "mstory";
    var name = p.pet_name ? esc(p.pet_name) : L("牠", "Them");
    var years = p.years ? '<span class="ms-years">' + esc(p.years) + "</span>" : "";
    var one = p.one_line ? '<blockquote class="ms-one">「' + esc(p.one_line) + "」</blockquote>" : "";
    var story = p.body ? '<div class="ms-story">' + esc(p.body).replace(/\n/g, "<br>") + "</div>" : "";
    var by = '<span class="ms-by">— ' + (p.name ? esc(p.name) : L("一位主人", "A pet parent")) + "</span>";
    var hearted = false; try { hearted = !!localStorage.getItem(heartedKey(p.id)); } catch (e) {}
    el.innerHTML =
      (p.image_path ? '<img class="ms-photo" src="' + esc(pubUrl(p.image_path)) + '" alt="' + name + '" loading="lazy">' : "") +
      '<div class="ms-head"><span class="ms-name">' + name + "</span>" + years + "</div>" +
      one + story +
      '<div class="ms-foot">' + by +
      '<button class="ms-heart' + (hearted ? " on" : "") + '" type="button" data-id="' + esc(p.id) + '"' + (hearted ? " disabled" : "") + '>🤍 <span>' + (p.hearts || 0) + "</span></button></div>";
    return el;
  }

  function bindHearts() {
    list.querySelectorAll(".ms-heart").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-id");
        try { if (localStorage.getItem(heartedKey(id))) return; } catch (e) {}
        btn.disabled = true;
        fetch(SB_URL + "/rest/v1/rpc/increment_post_heart", {
          method: "POST",
          headers: Object.assign({}, H, { "Content-Type": "application/json" }),
          body: JSON.stringify({ p_id: id })
        }).then(function (r) { return r.json(); }).then(function (n) {
          var s = btn.querySelector("span");
          if (typeof n === "number" && s) s.textContent = n;
          btn.classList.add("on");
          try { localStorage.setItem(heartedKey(id), "1"); } catch (e) {}
        }).catch(function () { btn.disabled = false; });
      });
    });
  }

  /* ---------- 載入列表 / 單一連結故事 ---------- */
  function render(rows, focused) {
    list.innerHTML = "";
    if (focused && rows.length) {
      var back = document.createElement("div");
      back.className = "board-note";
      back.style.textAlign = "center";
      back.style.marginBottom = "18px";
      back.innerHTML = '<a href="' + location.pathname + '">' + L("← 查看全部故事", "← See all stories") + "</a>";
      list.appendChild(back);
    }
    if (!rows.length) {
      list.innerHTML = '<div class="board-note" style="text-align:center;padding:20px 0;">' +
        (focused ? L("找不到這個故事，或仍在審核中。", "This story can't be found, or is still under review.")
                 : L("還沒有公開的故事。願意的話，成為第一個分享的人。", "No public stories yet. If you'd like, be the first to share.")) + "</div>";
      return;
    }
    rows.forEach(function (p) { list.appendChild(card(p)); });
    bindHearts();
  }

  function load() {
    var m = location.search.match(/[?&]s=([0-9a-f-]{8,})/i);
    if (m) {
      // 連結分享：憑 slug 經 RLS-safe RPC 精準取一條（link 故事唔會被公開列舉）
      fetch(SB_URL + "/rest/v1/rpc/get_post_by_slug", {
        method: "POST",
        headers: Object.assign({}, H, { "Content-Type": "application/json" }),
        body: JSON.stringify({ p_slug: m[1] })
      })
        .then(function (r) { return r.json(); })
        .then(function (rows) { render(Array.isArray(rows) ? rows : [], true); })
        .catch(function () { render([], true); });
      return;
    }
    fetch(SB_URL + "/rest/v1/posts?select=id,pet_name,years,one_line,body,name,image_path,hearts&context=eq.memorial&status=eq.visible&visibility=eq.public&order=created_at.desc&limit=100", { headers: H })
      .then(function (r) { return r.json(); })
      .then(function (rows) { render(Array.isArray(rows) ? rows : [], false); })
      .catch(function () { render([], false); });
  }

  /* ---------- 相片：壓縮 + 預覽 ---------- */
  var photoBlob = null;
  var photoInput = document.getElementById("mPhoto");
  if (photoInput) {
    photoInput.addEventListener("change", function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var img = new Image();
      img.onload = function () {
        var mx = 1200, sc = Math.min(1, mx / Math.max(img.width, img.height));
        var c = document.createElement("canvas");
        c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(function (b) {
          photoBlob = b;
          var pv = document.getElementById("mPreview");
          if (pv) { pv.src = URL.createObjectURL(b); pv.style.display = "block"; }
        }, "image/jpeg", 0.82);
      };
      img.src = URL.createObjectURL(f);
    });
  }
  function uploadPhoto() {
    if (!photoBlob) return Promise.resolve(null);
    var name = "memorial/" + Date.now() + "-" + Math.random().toString(36).slice(2) + ".jpg";
    return fetch(SB_URL + "/storage/v1/object/board-images/" + name, {
      method: "POST",
      headers: Object.assign({}, H, { "Content-Type": "image/jpeg", "x-upsert": "false" }),
      body: photoBlob
    }).then(function (r) { if (!r.ok) throw new Error("upload"); return name; });
  }

  /* ---------- 狀態列 ---------- */
  var statusEl = document.getElementById("mStatus");
  function setStatus(msg, ok) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.style.color = ok ? "var(--gold-deep)" : "var(--ink-faint)";
  }
  function val(id) { var e = document.getElementById(id); return e ? (e.value || "").trim() : ""; }

  /* ---------- 提交 ---------- */
  var postBtn = document.getElementById("mPost");
  if (postBtn) {
    postBtn.addEventListener("click", function () {
      var pet = val("mPet"), story = val("mStory"), one = val("mOne");
      if (!pet && !story && !photoBlob) { setStatus(L("至少填毛孩名字、一段故事或加一張相片。", "Add at least a name, a story or a photo.")); return; }
      if (crisis(story)) { var sb = document.getElementById("supportBtn"); if (sb) sb.click(); }
      var vis = val("mVis") || "public";
      var slug = null;
      if (vis === "link" && window.crypto && crypto.randomUUID) slug = crypto.randomUUID();

      postBtn.disabled = true;
      setStatus(L("正在送出…", "Sending…"));
      uploadPhoto().then(function (path) {
        var rec = {
          context: "memorial",
          pet_name: pet || null,
          years: val("mYears") || null,
          one_line: one || null,
          body: story || (one || (pet ? (L("紀念 ", "In memory of ") + pet) : L("（分享了一張相片）", "(shared a photo)"))),
          name: val("mName") || null,
          image_path: path,
          visibility: vis
        };
        if (slug) rec.slug = slug;
        return fetch(SB_URL + "/rest/v1/posts", {
          method: "POST",
          headers: Object.assign({}, H, { "Content-Type": "application/json", "Prefer": "return=minimal" }),
          body: JSON.stringify(rec)
        });
      }).then(function (r) {
        if (!r.ok) throw new Error("insert");
        // 清空表單
        ["mPet", "mYears", "mOne", "mStory", "mName"].forEach(function (id) { var e = document.getElementById(id); if (e) e.value = ""; });
        photoBlob = null;
        var pv = document.getElementById("mPreview"); if (pv) { pv.style.display = "none"; pv.src = ""; }
        var share = document.getElementById("mShare");
        if (vis === "link" && slug) {
          var url = location.origin + location.pathname + "?s=" + slug;
          setStatus(L("已建立只限連結的紀念頁 🤍 審核後即可用連結分享。", "Your link-only page is created 🤍 it will work via the link after review."), true);
          if (share) {
            share.hidden = false;
            share.innerHTML = '<div class="mshare-in"><input readonly value="' + esc(url) + '"><button type="button" id="mCopy">' + L("複製連結", "Copy link") + "</button></div>";
            var cp = document.getElementById("mCopy");
            if (cp) cp.addEventListener("click", function () {
              try { navigator.clipboard.writeText(url); cp.textContent = L("已複製 ✓", "Copied ✓"); } catch (e) {}
            });
          }
        } else {
          setStatus(L("多謝分享 🤍 經審核後會顯示喺分享頁。", "Thank you for sharing 🤍 it will appear here after review."), true);
          if (share) share.hidden = true;
        }
      }).catch(function () {
        setStatus(L("送出失敗，請稍後再試。", "Failed to send, please try again later."));
      }).then(function () { postBtn.disabled = false; });
    });
  }

  /* ---------- AI 寫信助手：用表單內容草擬故事 ---------- */
  var letterBtn = document.getElementById("mLetterBtn");
  if (letterBtn) {
    letterBtn.addEventListener("click", function () {
      var pet = val("mPet"), story = val("mStory");
      if (story && !confirm(L("這會用 AI 草稿覆蓋現有故事內容，繼續？", "This will replace the current story with an AI draft. Continue?"))) return;
      var old = letterBtn.innerHTML; letterBtn.disabled = true; letterBtn.innerHTML = L("正在草擬…", "Drafting…");
      fetch("/api/write-letter", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ petName: pet, years: val("mYears"), trait: val("mOne"), memory: story, tone: "溫柔", lang: EN ? "en" : "zh" })
      }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (x) {
          if (x.ok && x.d && x.d.letter) {
            var t = String(x.d.letter).replace(/^\s*[（(]?\s*(約|approx\.?)?\s*\d+\s*(字|個字|characters?|words?)\s*[）)]?\s*/i, "").trim();
            var e = document.getElementById("mStory"); if (e) e.value = t;
            setStatus(L("已幫你草擬，可自由修改後再分享。", "Drafted for you — edit freely, then share."), true);
          } else {
            setStatus(L("暫時未能草擬，請稍後再試，或直接自己寫。", "Couldn't draft just now — please try again, or write your own."));
          }
        }).catch(function () { setStatus(L("網絡不穩定，請稍後再試。", "Network issue, please try again later.")); })
        .then(function () { letterBtn.disabled = false; letterBtn.innerHTML = old; });
    });
  }

  load();
})();
