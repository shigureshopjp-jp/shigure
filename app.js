const LIFF_ID = "2009561157-Ppp6XigR";
const API_BASE = "https://script.google.com/macros/s/AKfycby28sQrY2zBTelMRwve6i2IguXGFXKD8FapkEJmfcYlsfxxugwVFI9Z56mRFz1d6yQh/exec";

const CART_KEY = "shigure_cart_v1";

let LOGIN_RESULT = {
  isLoggedIn: false,
  displayName: "",
  userId: "",
  isFriend: false
};

let ALL_ITEMS = [];
let PRODUCT_GROUPS = {};
let confirmResolver = null;
let cartModalInstance = null;
let confirmModalInstance = null;
let productModalInstance = null;
let currentProduct = null;
let currentVariant = null;

function log(...args) {
  console.log(...args);
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeJs(str) {
  return String(str ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "\\'");
}

function showToast(message, type = "") {
  const toastEl = document.getElementById("appToast");
  const bodyEl = document.getElementById("appToastBody");
  bodyEl.textContent = message;
  toastEl.className = "toast custom-toast";
  if (type) toastEl.classList.add(type);
  bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 2200 }).show();
}

function setLoading(isLoading) {
  const overlay = document.getElementById("loadingOverlay");
  overlay.style.display = isLoading ? "flex" : "none";

  document.querySelectorAll("button, input").forEach(el => {
    el.disabled = !!isLoading;
  });
}

function initModals() {
  cartModalInstance = new bootstrap.Modal(document.getElementById("cartModal"));
  confirmModalInstance = new bootstrap.Modal(document.getElementById("confirmModal"));
  productModalInstance = new bootstrap.Modal(document.getElementById("productModal"));
}

function renderLoginStatus(message = "") {
  const el = document.getElementById("loginStatusArea");

  if (!LOGIN_RESULT.isLoggedIn) {
    el.innerHTML = `
      <div class="soft-card status-card mb-3">
        <div class="status-title">LINE 使用狀態</div>
        <div class="status-text">${escapeHtml(message || "尚未登入")}</div>
      </div>
    `;
    return;
  }

  el.innerHTML = `
    <div class="soft-card status-card mb-3">
      <div class="status-meta">
        您好，${escapeHtml(LOGIN_RESULT.displayName)}<br>
        <span class="mobile-hide">userId：${escapeHtml(LOGIN_RESULT.userId)}</span>
      </div>
    </div>
  `;
}

async function initLiff() {
  try {
    await liff.init({ liffId: LIFF_ID });

    log("liff.isInClient()", liff.isInClient());
    log("liff.isLoggedIn()", liff.isLoggedIn());
    log("liff.getOS()", liff.getOS());

    // 外部瀏覽器仍允許 login，避免電腦完全不能測
    if (!liff.isLoggedIn()) {
      liff.login({ redirectUri: window.location.href });
      return false;
    }

    const profile = await liff.getProfile();

    LOGIN_RESULT.isLoggedIn = true;
    LOGIN_RESULT.displayName = profile.displayName || "";
    LOGIN_RESULT.userId = profile.userId || "";
    LOGIN_RESULT.isFriend = true;

    return true;
  } catch (err) {
    console.error("initLiff error:", err);
    renderLoginStatus("LINE 初始化失敗");
    document.getElementById("loading").style.display = "none";
    document.getElementById("app").innerHTML =
      '<div class="soft-card empty-box">LINE 初始化失敗，請稍後再試。</div>';
    showToast("LINE 初始化失敗", "error");
    return false;
  }
}

async function apiGet(action, params = {}) {
  const url = new URL(API_BASE);
  url.searchParams.set("action", action);
  Object.entries(params).forEach(([k, v]) => {
    if (v != null) url.searchParams.set(k, v);
  });

  const res = await fetch(url.toString(), {
    method: "GET"
  });
  if (!res.ok) throw new Error("GET API failed");
  return await res.json();
}

async function apiPost(action, data = {}) {
  const url = new URL(API_BASE);
  url.searchParams.set("action", action);

  // 避免 preflight，使用 form-urlencoded
  const body = new URLSearchParams();
  Object.entries(data).forEach(([k, v]) => {
    body.append(k, typeof v === "string" ? v : JSON.stringify(v));
  });

  const res = await fetch(url.toString(), {
    method: "POST",
    body
  });
  if (!res.ok) throw new Error("POST API failed");
  return await res.json();
}

async function autoRegisterUserApi(userId, displayName) {
  return await apiPost("autoRegisterUser", { userId, displayName });
}

async function fetchSellListItems() {
  return await apiGet("getSellListItems");
}

async function createDraftOrdersFromCartApi(userId, displayName, payload) {
  return await apiPost("createDraftOrdersFromCart", {
    userId,
    displayName,
    payload
  });
}

function getCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY) || "[]");
  } catch (e) {
    log("getCart error", e);
    return [];
  }
}

function setCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateCartCount();
}

function updateCartCount() {
  const cart = getCart();
  const count = cart.reduce((sum, x) => sum + Number(x.qty || 0), 0);
  document.getElementById("cartCount").textContent = count;
}

function renderItems(items) {
  ALL_ITEMS = items || [];
  updateCartCount();

  const app = document.getElementById("app");
  const loading = document.getElementById("loading");
  loading.style.display = "none";

  if (!items || items.length === 0) {
    app.innerHTML = '<div class="soft-card empty-box">目前沒有商品</div>';
    return;
  }

  const groups = {};
  items.forEach(item => {
    const key = item.orderProduct;
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  });
  PRODUCT_GROUPS = groups;

  const html = `
    <div class="row g-3">
      ${Object.entries(groups).map(([productName, list]) => {
        const first = list[0];
        const image = first.image || "";
        const minPrice = Math.min(...list.map(x => Number(x.price || 0)));

        return `
          <div class="col-12 col-lg-6 col-xl-4">
            <div class="soft-card product-card" onclick="openProductModal('${escapeJs(productName)}')">
              <div class="product-image-wrap">
                ${
                  image
                    ? `<img class="product-image" src="${escapeHtml(image)}" onerror="this.parentNode.innerHTML='<div class=&quot;no-image&quot;>尚無圖片</div>';">`
                    : `<div class="no-image">尚無圖片</div>`
                }
              </div>

              <div class="product-title">${escapeHtml(productName)}</div>
              <div class="product-meta">共 ${list.length} 個品項</div>
              <div class="product-price">NT$${minPrice} 起</div>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;

  app.innerHTML = html;
}

function openProductModal(productName) {
  const list = PRODUCT_GROUPS[productName];
  currentProduct = list;
  currentVariant = list[0];
  renderProductModal();
  productModalInstance.show();
}

function renderProductModal() {
  const item = currentVariant;

  const html = `
    <div>
      <div class="product-image-wrap mb-3">
        ${
          item.image
            ? `<img class="product-image" src="${escapeHtml(item.image)}" onerror="this.parentNode.innerHTML='<div class=&quot;no-image&quot;>尚無圖片</div>';">`
            : `<div class="no-image">尚無圖片</div>`
        }
      </div>

      <div class="product-title mb-2">${escapeHtml(item.orderProduct)}</div>
      <div class="product-price mb-2">NT$${Number(item.price || 0)}</div>
      <div class="product-meta mb-3">${escapeHtml(item.description || "")}</div>

      <div class="mb-2">選擇品項</div>
      <div class="d-flex flex-wrap gap-2 mb-3">
        ${currentProduct.map(x => `
          <button
            class="btn ${x.sku === item.sku ? 'btn-brand' : 'btn-brand-soft'}"
            onclick="selectVariant('${escapeJs(x.sku)}')"
          >
            ${escapeHtml(x.itemName)}
          </button>
        `).join("")}
      </div>

      <div class="mb-3">
        <div class="qty-label">數量</div>
        <input id="modalQty" type="number" class="form-control qty-input" value="1" min="1">
      </div>

      <button class="btn btn-brand w-100" onclick="addFromModal()">加入購物車</button>
    </div>
  `;

  document.getElementById("productModalBody").innerHTML = html;
}

function selectVariant(sku) {
  currentVariant = currentProduct.find(x => x.sku === sku);
  renderProductModal();
}

function addFromModal() {
  const qty = Math.max(1, Number(document.getElementById("modalQty").value || 1));
  const item = currentVariant;

  const cart = getCart();
  const idx = cart.findIndex(x => x.sku === item.sku);

  if (idx >= 0) {
    cart[idx].qty += qty;
    if (!cart[idx].image && item.image) {
      cart[idx].image = item.image;
    }
  } else {
    cart.push({
      sku: item.sku,
      orderProduct: item.orderProduct,
      itemName: item.itemName,
      price: Number(item.price || 0),
      shippingFee: Number(item.shippingFee || 0),
      image: item.image || "",
      qty
    });
  }

  setCart(cart);
  productModalInstance.hide();
  showToast("已加入購物車", "success");
}

function openCart() {
  renderCart();
  cartModalInstance.show();
}

function closeCart() {
  cartModalInstance.hide();
}

function showConfirm(message) {
  return new Promise(resolve => {
    confirmResolver = resolve;
    document.getElementById("confirmText").textContent = message;
    confirmModalInstance.show();
  });
}

function closeConfirm(result) {
  confirmModalInstance.hide();
  if (confirmResolver) {
    confirmResolver(result);
    confirmResolver = null;
  }
}

function renderCart() {
  const cart = getCart();
  const cartBody = document.getElementById("cartBody");
  const cartFooter = document.getElementById("cartFooter");

  if (!cart.length) {
    cartBody.innerHTML = '<div class="soft-card empty-box">購物車目前沒有商品。</div>';
    cartFooter.innerHTML = `
      <button class="btn btn-brand-soft w-100" type="button" onclick="closeCart()">關閉</button>
    `;
    return;
  }

  const total = cart.reduce((sum, x) => sum + Number(x.price || 0) * Number(x.qty || 0), 0);

  cartBody.innerHTML = `
    <div class="d-grid gap-3">
      ${cart.map((item, index) => `
        <div class="cart-item">
          <div class="d-flex gap-3 align-items-start">
            <div style="width:72px; height:72px; flex:0 0 72px; border-radius:12px; overflow:hidden; background:#f5efe8;">
              ${
                item.image
                  ? `<img src="${escapeHtml(item.image)}" style="width:100%; height:100%; object-fit:cover;" onerror="this.parentNode.innerHTML='<div style=&quot;width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#999;font-size:12px;&quot;>無圖</div>';">`
                  : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#999;font-size:12px;">無圖</div>`
              }
            </div>

            <div class="flex-grow-1">
              <div class="cart-item-title">${escapeHtml(item.orderProduct)}</div>
              <div class="cart-item-meta">
                SKU：${escapeHtml(item.sku)}<br>
                品項：${escapeHtml(item.itemName)}<br>
                單價：${Number(item.price || 0)} 元
              </div>
            </div>
          </div>

          <div class="mb-3 mt-3">
            <div class="qty-label">數量</div>
            <input
              class="form-control qty-input"
              type="number"
              min="1"
              value="${Number(item.qty || 1)}"
              onchange="updateCartQty(${index}, this.value)"
            >
          </div>

          <button class="btn btn-brand-danger w-100" type="button" onclick="removeCartItem(${index})">刪除</button>
        </div>
      `).join("")}
    </div>
  `;

  cartFooter.innerHTML = `
    <div class="cart-total mb-3">商品總額：${total} 元</div>
    <div class="d-grid gap-2 d-md-flex">
      <button class="btn btn-brand-soft flex-md-fill" type="button" onclick="clearCart()">清空購物車</button>
      <button class="btn btn-brand flex-md-fill" type="button" onclick="submitCart()">送出下單</button>
    </div>
  `;
}

function updateCartQty(index, value) {
  const cart = getCart();
  const qty = Math.max(1, Number(value || 1));
  if (!cart[index]) return;
  cart[index].qty = qty;
  setCart(cart);
  renderCart();
}

function removeCartItem(index) {
  const cart = getCart();
  cart.splice(index, 1);
  setCart(cart);
  renderCart();
}

async function clearCart() {
  const ok = await showConfirm("確定要清空購物車嗎？");
  if (!ok) return;
  setCart([]);
  renderCart();
  showToast("已清空購物車", "success");
}

async function submitCart() {
  if (!(LOGIN_RESULT.isLoggedIn && LOGIN_RESULT.isFriend)) {
    showToast("請先完成 LINE 登入並加入官方好友後再下單", "error");
    return;
  }

  const cart = getCart();
  if (!cart.length) {
    showToast("購物車是空的", "error");
    return;
  }

  const payload = cart.map(x => ({
    sku: x.sku,
    qty: Number(x.qty || 0)
  }));

  setLoading(true);

  try {
    const result = await createDraftOrdersFromCartApi(
      LOGIN_RESULT.userId,
      LOGIN_RESULT.displayName,
      payload
    );

    setCart([]);
    closeCart();

    document.getElementById("successBox").innerHTML = `
      <div class="success-box">
        下單成功，已建立 ${result.count} 張暫存訂單 ✅<br><br>
        ${result.orders.map(x => `
          訂單編號：${escapeHtml(x.orderId)}<br>
          訂購商品：${escapeHtml(x.orderProduct)}<br>
          品項：${escapeHtml(x.itemSummary)}<br>
          商品總額：${Number(x.totalAmount || 0)} 元<br>
        `).join("<br>")}
        <br>
        請回官方 LINE 使用「查詢訂單」確認內容與後續通知。
      </div>
    `;
    showToast("暫存訂單建立成功", "success");
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (err) {
    console.error("submitCart error", err);
    showToast("建立暫存訂單失敗", "error");
  } finally {
    setLoading(false);
  }
}

document.addEventListener("DOMContentLoaded", async function() {
  initModals();
  updateCartCount();
  renderLoginStatus("正在初始化 LINE…");

  const ok = await initLiff();
  if (!ok) return;

  renderLoginStatus();

  try {
    await autoRegisterUserApi(LOGIN_RESULT.userId, LOGIN_RESULT.displayName);
    console.log("auto register ok");
  } catch (err) {
    console.error("auto register fail:", err);
  }

  try {
    const items = await fetchSellListItems();
    renderItems(items);
  } catch (err) {
    console.error("getSellListItems error", err);
    document.getElementById("loading").style.display = "none";
    document.getElementById("app").innerHTML =
      '<div class="soft-card empty-box">商品目前無法載入</div>';
  }
});
