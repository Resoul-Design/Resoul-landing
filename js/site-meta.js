(function () {
  "use strict";

  var path = window.location.pathname.replace(/\/$/, "") || "/";
  var routes = {
    "/cremation": ["/cremation", "/cremation-en"],
    "/cremation-en": ["/cremation", "/cremation-en"],
    "/booking": ["/booking", "/booking-en"],
    "/booking-en": ["/booking", "/booking-en"]
  };
  var localized = routes[path];
  if (!localized) return;

  fetch("/api/site-config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  }).then(function (response) {
    if (!response.ok) throw new Error("Site URL configuration unavailable");
    return response.json();
  }).then(function (config) {
    var base = new URL(config.siteUrl).origin;
    var canonicalUrl = base + path;
    var canonical = document.querySelector('link[rel="canonical"]');
    var ogUrl = document.querySelector('meta[property="og:url"]');
    if (canonical) canonical.href = canonicalUrl;
    if (ogUrl) ogUrl.content = canonicalUrl;

    var alternateLinks = document.querySelectorAll('link[rel="alternate"][hreflang]');
    alternateLinks.forEach(function (link) {
      var lang = link.hreflang;
      var target = lang === "en" ? localized[1] : localized[0];
      link.href = base + target;
    });

    var structuredData = document.getElementById("pageStructuredData");
    if (structuredData) {
      var pageData = JSON.parse(structuredData.textContent);
      pageData.url = canonicalUrl;
      pageData["@id"] = canonicalUrl + "#webpage";
      structuredData.textContent = JSON.stringify(pageData);
    }
  }).catch(function (error) {
    console.warn("[Resoul] Could not apply SITE_URL metadata:", error);
  });
})();
