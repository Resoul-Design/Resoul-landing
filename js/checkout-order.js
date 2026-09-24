(function () {
  "use strict";

  var form = document.getElementById("orderForm");
  if (!form) return;

  var isEnglish = document.documentElement.lang === "en";
  var copy = isEnglish ? {
    deposit: "Pick-up booking deposit",
    project: "Project number",
    invoice: "Invoice number",
    payment: "Payment reference",
    projectLabel: "Existing project number (optional for returning clients)",
    confirmTitle: "Please confirm your booking details",
    confirmLead: "Check your details before continuing to secure payment.",
    edit: "Edit details",
    pay: "Confirm and pay",
    submit: "Proceed to payment",
    invalidProject: "Enter a valid project number starting with RSL-, or leave it blank for a new project.",
    required: "Please enter your name and phone / WhatsApp.",
    loading: "Processing...",
    success: "Details received. Redirecting to secure payment...",
    failed: "We could not create the secure payment session. Please try again or contact us and quote your payment reference: ",
    serverFailed: "We could not save your booking. Please try again or contact us and quote your payment reference: ",
    projectRow: "Project number",
    paymentRow: "Payment reference",
    item: "Item",
    amount: "Deposit",
    projectAttr: "Project number",
    source: "Website pick-up booking EN",
    noteHead: "Pick-up booking deposit",
    projectNote: "Project number: ",
    phone: "Phone / WhatsApp",
    owner: "Your name",
    pet: "Pet's name",
    date: "Preferred date",
    time: "Preferred time",
    address: "Pickup address",
    notes: "Notes",
    urgent: "Urgent pick-up? Call us: +852 6476 2951"
  } : {
    deposit: "預約接送訂金",
    project: "專案編號",
    invoice: "發票編號",
    payment: "付款參考",
    projectLabel: "已有專案編號（回訪客戶可選填）",
    confirmTitle: "確認預約資料",
    confirmLead: "請確認以下資料無誤，再前往安全付款頁。",
    edit: "返回修改",
    pay: "確認並前往付款",
    submit: "前往付款",
    invalidProject: "請輸入以 RSL- 開頭的專案編號；如為新專案，請留空。",
    required: "請填寫主人稱呼及聯絡電話。",
    loading: "處理中…",
    success: "已收到資料，正在前往安全付款頁…",
    failed: "暫時未能建立安全付款頁，請重試或聯絡我們，並提供付款參考：",
    serverFailed: "暫時未能儲存預約資料，請重試或聯絡我們，並提供付款參考：",
    projectRow: "專案編號",
    paymentRow: "付款參考",
    item: "項目",
    amount: "訂金",
    projectAttr: "專案編號 Project no.",
    source: "網站安排預約接送",
    noteHead: "預約接送訂金",
    projectNote: "專案編號：",
    phone: "聯絡電話 / WhatsApp",
    owner: "主人稱呼",
    pet: "毛孩名字",
    date: "希望日期",
    time: "希望時段",
    address: "接送地址",
    notes: "備註",
    urgent: "緊急接送？請致電：+852 6476 2951"
  };

  var endpoint = "https://qs1nmv-b3.myshopify.com/api/2026-01/graphql.json";
  var storefrontToken = "90f06d055534783ae5a7ad3f0f1e5004";
  var depositSku = "RS-DEPOSIT";
  var submitButton = document.getElementById("ofBtn");
  var message = document.getElementById("ofMsg");
  var confirmModal = document.getElementById("orderConfirm");
  var confirmList = document.getElementById("orderConfirmList");
  var confirmButton = document.getElementById("orderConfirmBtn");
  var editButton = document.getElementById("orderEditBtn");
  var pending = null;

  function value(id) {
    var field = document.getElementById(id);
    return field ? field.value.trim() : "";
  }

  function show(kind, text) {
    if (!message) return;
    message.className = "book-msg " + kind;
    message.textContent = text;
    message.hidden = false;
  }

  function makeProjectNumber() {
    var now = new Date();
    var date = String(now.getFullYear()).slice(-2) + String(now.getMonth() + 1).padStart(2, "0") + String(now.getDate()).padStart(2, "0");
    var bytes = new Uint8Array(5);
    crypto.getRandomValues(bytes);
    return "RSL-" + date + "-" + Array.from(bytes, function (byte) {
      return byte.toString(36).padStart(2, "0");
    }).join("").slice(0, 8).toUpperCase();
  }

  function paymentReference() {
    return "PAY-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomUUID().slice(0, 8).toUpperCase();
  }

  function safeRow(label, text) {
    var row = document.createElement("div");
    var key = document.createElement("span");
    var val = document.createElement("span");
    row.className = "confirm-row";
    key.textContent = label;
    val.textContent = text || "—";
    row.append(key, val);
    return row;
  }

  function openConfirmation(data) {
    pending = data;
    confirmList.replaceChildren(
      safeRow(copy.item, copy.deposit + " · HK$1,800"),
      safeRow(copy.projectRow, data.projectNumber),
      safeRow(copy.paymentRow, data.paymentRef),
      safeRow(copy.pet, value("ofPet")),
      safeRow(copy.owner, value("ofName")),
      safeRow(copy.phone, value("ofPhone")),
      safeRow(copy.date, value("ofDate")),
      safeRow(copy.time, value("ofTime")),
      safeRow(copy.address, value("ofAddr")),
      safeRow(copy.notes, value("ofNote"))
    );
    confirmModal.classList.add("open");
    confirmModal.setAttribute("aria-hidden", "false");
  }

  function closeConfirmation() {
    confirmModal.classList.remove("open");
    confirmModal.setAttribute("aria-hidden", "true");
  }

  function findDepositVariant() {
    var query = "query DepositProduct($query: String!) { products(first: 10, query: $query) { nodes { title variants(first: 100) { nodes { id sku price { amount currencyCode } } } } } }";
    return fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Storefront-Access-Token": storefrontToken },
      body: JSON.stringify({ query: query, variables: { query: 'title:"預約接送訂金｜安排預約接送"' } })
    }).then(function (response) {
      if (!response.ok) throw new Error("Shopify product lookup failed");
      return response.json();
    }).then(function (result) {
      var products = result && result.data && result.data.products && result.data.products.nodes || [];
      var matches = [];
      products.forEach(function (product) {
        (product.variants && product.variants.nodes || []).forEach(function (variant) {
          if (variant.sku === depositSku) matches.push({ id: variant.id, sku: variant.sku, price: variant.price, title: product.title });
        });
      });
      if (result.errors || matches.length !== 1) throw new Error("Expected exactly one RS-DEPOSIT product");
      var variant = matches[0];
      if (variant.price.currencyCode !== "HKD" || Number(variant.price.amount) !== 1800) throw new Error("Deposit price does not match the booking amount");
      if (variant.title !== "預約接送訂金｜安排預約接送") throw new Error("Unexpected deposit product");
      return variant;
    });
  }

  function createCart(variant, data) {
    var attributes = [
      { key: "project_no", value: data.projectNumber },
      { key: "payment_ref", value: data.paymentRef },
      { key: "Item", value: copy.deposit },
      { key: "Deposit", value: "HKD 1800" },
      { key: "Pet name", value: value("ofPet") || "-" },
      { key: "Customer name", value: value("ofName") },
      { key: "Phone", value: value("ofPhone") },
      { key: "Preferred date", value: value("ofDate") || "-" },
      { key: "Preferred time", value: value("ofTime") || "-" },
      { key: "Pickup address", value: value("ofAddr") || "-" },
      { key: "Notes", value: value("ofNote") || "-" }
    ];
    var query = "mutation CreateDepositCart($lines: [CartLineInput!]!, $attributes: [AttributeInput!]!) { cartCreate(input: { lines: $lines, attributes: $attributes }) { cart { checkoutUrl } userErrors { message } } }";
    return fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Storefront-Access-Token": storefrontToken },
      body: JSON.stringify({
        query: query,
        variables: {
          lines: [{ merchandiseId: variant.id, quantity: 1, attributes: attributes }],
          attributes: [
            { key: "project_no", value: data.projectNumber },
            { key: "payment_ref", value: data.paymentRef },
            { key: "Booking source", value: copy.source }
          ]
        }
      })
    }).then(function (response) {
      if (!response.ok) throw new Error("Shopify cart request failed");
      return response.json();
    }).then(function (result) {
      var cart = result && result.data && result.data.cartCreate;
      var checkoutUrl = cart && cart.cart && cart.cart.checkoutUrl;
      if (!checkoutUrl || cart.userErrors && cart.userErrors.length) throw new Error("Shopify did not return a checkout URL");
      return checkoutUrl;
    });
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var enteredProject = value("ofProject").toUpperCase();
    if (enteredProject && !/^RSL-[A-Z0-9]+-[A-Z0-9]+$/.test(enteredProject)) {
      show("err", copy.invalidProject);
      return;
    }
    if (!value("ofName") || !value("ofPhone")) {
      show("err", copy.required);
      return;
    }
    var projectField = document.getElementById("ofProject");
    var projectNumber = enteredProject || makeProjectNumber();
    projectField.value = projectNumber;
    openConfirmation({ projectNumber: projectNumber, paymentRef: paymentReference() });
  });

  editButton.addEventListener("click", closeConfirmation);
  confirmModal.addEventListener("click", function (event) {
    if (event.target === confirmModal) closeConfirmation();
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && confirmModal.classList.contains("open")) closeConfirmation();
  });

  confirmButton.addEventListener("click", function () {
    if (!pending) return;
    var data = pending;
    var oldSubmit = submitButton.innerHTML;
    var oldConfirm = confirmButton.innerHTML;
    closeConfirmation();
    submitButton.disabled = true;
    confirmButton.disabled = true;
    submitButton.textContent = copy.loading;
    confirmButton.textContent = copy.loading;
    message.hidden = true;

    var payload = {
      owner_name: value("ofName"),
      contact: value("ofPhone"),
      project_no: data.projectNumber,
      plan: copy.deposit,
      pet_name: value("ofPet") || null,
      pet_type: null,
      service_date: value("ofDate") || null,
      service_time: value("ofTime") || null,
      pickup_address: value("ofAddr") || null,
      notes: copy.projectNote + data.projectNumber + " | " + copy.payment + ": " + data.paymentRef + " | " + copy.pet + ": " + (value("ofPet") || "-") + " | " + copy.time + ": " + (value("ofTime") || "-") + " | " + copy.notes + ": " + (value("ofNote") || "-"),
      source: "web:pickup-deposit",
      payment_ref: data.paymentRef,
      payment_status: "pending",
      payment_amount: 1800,
      payment_currency: "HKD"
    };

    fetch("/api/deposit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (response) {
      if (!response.ok) throw new Error("Booking save failed");
      return findDepositVariant();
    }).then(function (variant) {
      return createCart(variant, data);
    }).then(function (checkoutUrl) {
      show("ok", copy.success);
      window.location.assign(checkoutUrl);
    }).catch(function (error) {
      console.error("[Resoul] Deposit checkout failed:", error);
      show("err", (error.message === "Booking save failed" ? copy.serverFailed : copy.failed) + data.paymentRef);
      submitButton.disabled = false;
      confirmButton.disabled = false;
      submitButton.innerHTML = oldSubmit;
      confirmButton.innerHTML = oldConfirm;
    });
  });
})();
