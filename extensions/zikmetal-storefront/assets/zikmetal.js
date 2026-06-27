/*
 * ZikMetal Live Pricing Engine (storefront)
 * -----------------------------------------
 * A single, global pricing engine that renders live MCX silver-rate prices
 * everywhere on the storefront: product detail pages, collection grids,
 * product cards, quick-view modals and the cart drawer.
 *
 * Design:
 *  - The live silver rate is fetched ONCE and cached globally
 *    (window.ZikMetal.state.rate), then reused across every component.
 *  - Per-product attributes (weight, making, gst, profit, shipping) + base
 *    price are fetched in batches from the App Proxy and cached.
 *  - A centralized calculatePrice() recomputes each visible price LOCALLY
 *    whenever the rate refreshes — no per-product refetch needed.
 *  - A MutationObserver re-scans the DOM for AJAX-loaded cards / quick views /
 *    cart drawer updates.
 *  - All failures fall back silently to the theme's own price.
 */
(function () {
  "use strict";

  var CFG = window.ZikMetalConfig || {};
  var PROXY_BASE = (CFG.proxyBase || "/apps/zikmetal-live-price").replace(/\/$/, "");
  var API = PROXY_BASE + "/api";

  var defaults = {
    refreshSeconds: 14400,
    showStrikethrough: true,
    showSavings: true,
    currency: (CFG.currency || "INR"),
    locale: (CFG.locale || "en-IN"),
    cardSelector: "[data-product-id], .card-wrapper, .grid__item, .product-card",
    productIdAttr: "data-product-id",
    priceSelector:
      ".price-item--regular, .price__regular .price-item, .price__sale .price-item--sale, .price, [data-zikmetal-amount]",
    cartSelector:
      "#cart-drawer, .cart-drawer, .drawer--cart, #CartDrawer, cart-drawer, .cart-items, #main-cart-items",
    debug: false,
  };
  var settings = Object.assign({}, defaults, CFG);

  function log() {
    if (settings.debug && window.console) {
      console.log.apply(console, ["[ZikMetal]"].concat([].slice.call(arguments)));
    }
  }

  /* ----------------------------------------------------------------------
   * Pricing formula (mirror of the backend — single source of truth)
   * -------------------------------------------------------------------- */
  function calculatePrice(attrs, rate) {
    var w = Number(attrs.weight_grams) || 0;
    var r = Number(rate) || 0;
    var making = Number(attrs.making_charge_per_gram) || 0;
    var gst = Number(attrs.gst_percent) || 0;
    var profit = Number(attrs.profit_percent) || 0;
    var compareAtProfit = attrs.compare_at_profit_percent !== undefined && attrs.compare_at_profit_percent !== null ? Number(attrs.compare_at_profit_percent) : profit;
    var shipping = Number(attrs.shipping_cost) || 0;

    // Step 1 - Metal Value
    var metalValue = r * w;
    
    // Step 2 - Vendor Cost
    var makingCharges = w * making;
    var vendorCost = metalValue + makingCharges;

    // Step 3 & 4 - Selling Price Before GST
    var profitAmount = vendorCost * (profit / 100);
    var sellingPriceBeforeGst = vendorCost + profitAmount;
    
    // Step 5 - GST
    var gstAmount = sellingPriceBeforeGst * (gst / 100);

    // Step 6 - Final Price
    var finalPrice = sellingPriceBeforeGst + gstAmount + shipping;

    // Calculate Compare-at Price using same logic
    var compareAtProfitAmount = vendorCost * (compareAtProfit / 100);
    var compareAtSellingPriceBeforeGst = vendorCost + compareAtProfitAmount;
    var compareAtGstAmount = compareAtSellingPriceBeforeGst * (gst / 100);
    var compareAtPrice = compareAtSellingPriceBeforeGst + compareAtGstAmount + shipping;

    return {
      finalPrice: Math.round(finalPrice * 100) / 100,
      compareAtPrice: Math.round(compareAtPrice * 100) / 100
    };
  }

  /* ----------------------------------------------------------------------
   * State
   * -------------------------------------------------------------------- */
  var state = {
    rate: null, // { rate, slot, currency, ... }
    products: {}, // numericId -> { enabled, attributes, basePrice, price, currencyCode }
    registry: {}, // numericId -> [ {container, amount, original, status, basePrice} ]
    pendingIds: {}, // ids discovered but not yet fetched
    started: false,
  };

  /* ----------------------------------------------------------------------
   * Money formatting
   * -------------------------------------------------------------------- */
  function money(amount, currency) {
    var cur = currency || settings.currency || "INR";
    try {
      return new Intl.NumberFormat(settings.locale || "en-IN", {
        style: "currency",
        currency: cur,
        maximumFractionDigits: 2,
      }).format(Number(amount) || 0);
    } catch (e) {
      return cur + " " + (Number(amount) || 0).toFixed(2);
    }
  }

  /* ----------------------------------------------------------------------
   * Fetch helpers (cache-busting, silent failure)
   * -------------------------------------------------------------------- */
  function getJSON(url) {
    var bust = (url.indexOf("?") === -1 ? "?" : "&") + "_=" + Date.now();
    return fetch(url + bust, { headers: { Accept: "application/json" } }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  function fetchRate() {
    return getJSON(API + "/mcx-rate")
      .then(function (data) {
        if (data && data.silverRate) {
          state.rate = data.silverRate;
          log("rate", state.rate.rate, state.rate.slot);
        }
        return state.rate;
      })
      .catch(function (e) {
        log("rate fetch failed", e.message);
        return state.rate;
      });
  }

  function fetchSettings() {
    return getJSON(API + "/settings")
      .then(function (s) {
        if (s && typeof s === "object") {
          if (typeof s.showStrikethrough === "boolean") settings.showStrikethrough = s.showStrikethrough;
          if (typeof s.showSavings === "boolean") settings.showSavings = s.showSavings;
          if (s.refreshSeconds) settings.refreshSeconds = s.refreshSeconds;
        }
      })
      .catch(function () {});
  }

  function chunk(arr, size) {
    var out = [];
    for (var i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  function fetchPrices(ids) {
    var unknown = ids.filter(function (id) {
      return !state.products[id];
    });
    if (!unknown.length) return Promise.resolve();

    var batches = chunk(unknown, 50);
    return Promise.all(
      batches.map(function (batch) {
        return getJSON(API + "/products/prices?ids=" + batch.join(","))
          .then(function (data) {
            if (data && data.silverRate) state.rate = data.silverRate;
            var prices = (data && data.prices) || {};
            Object.keys(prices).forEach(function (id) {
              state.products[id] = prices[id];
            });
          })
          .catch(function (e) {
            log("price fetch failed", e.message);
          });
      })
    );
  }

  /* ----------------------------------------------------------------------
   * Discovery — find price targets across all surfaces
   * -------------------------------------------------------------------- */
  function ensureSpans(container, amountEl) {
    // Add original (strike) + savings nodes next to the amount once.
    var original = container.querySelector("[data-zikmetal-original]");
    if (!original) {
      original = document.createElement("span");
      original.setAttribute("data-zikmetal-original", "");
      original.className = "zikmetal-original";
      original.hidden = true;
      amountEl.parentNode.insertBefore(original, amountEl);
    }
    var savings = container.querySelector("[data-zikmetal-savings]");
    if (!savings) {
      savings = document.createElement("span");
      savings.setAttribute("data-zikmetal-savings", "");
      savings.className = "zikmetal-savings";
      savings.hidden = true;
      amountEl.parentNode.insertBefore(savings, amountEl.nextSibling);
    }
    return { original: original, savings: savings };
  }

  function register(productId, container, amountEl, basePriceAttr) {
    if (!productId || !amountEl) return;
    if (amountEl.getAttribute("data-zikmetal-bound") === productId) return;
    amountEl.setAttribute("data-zikmetal-bound", productId);

    var extra = ensureSpans(container, amountEl);
    var basePrice = parseFloat(basePriceAttr);
    if (isNaN(basePrice)) basePrice = null;

    state.registry[productId] = state.registry[productId] || [];
    state.registry[productId].push({
      container: container,
      amount: amountEl,
      original: extra.original,
      savings: extra.savings,
      basePrice: basePrice,
    });
    state.pendingIds[productId] = true;
  }

  function idFromCard(card) {
    var attr = settings.productIdAttr;
    if (card.getAttribute && card.getAttribute(attr)) return card.getAttribute(attr);
    var child = card.querySelector ? card.querySelector("[" + attr + "]") : null;
    if (child) return child.getAttribute(attr);
    // Common theme hooks.
    var hook = card.querySelector
      ? card.querySelector("[data-product-id],[data-id]")
      : null;
    if (hook) return hook.getAttribute("data-product-id") || hook.getAttribute("data-id");
    return null;
  }

  function discover(root) {
    root = root || document;

    // 1. Explicit app-block / app-embed bound elements.
    var explicit = root.querySelectorAll("[data-zikmetal-product]");
    Array.prototype.forEach.call(explicit, function (el) {
      var id = el.getAttribute("data-zikmetal-product");
      var amount = el.querySelector("[data-zikmetal-amount]") || el;
      register(id, el, amount, el.getAttribute("data-zikmetal-base"));
    });

    // 2. Current product page (theme price elements).
    if (window.ZikMetalCurrentProduct && window.ZikMetalCurrentProduct.id) {
      var pid = String(window.ZikMetalCurrentProduct.id);
      var base = window.ZikMetalCurrentProduct.basePrice;
      var scope =
        root.querySelector(".product, [id^='MainProduct'], main, #MainContent") || root;
      var priceEls = scope.querySelectorAll(settings.priceSelector);
      Array.prototype.forEach.call(priceEls, function (el) {
        if (el.closest("[data-zikmetal-product]")) return;
        register(pid, el, el, base);
      });
    }

    // 3. Cards on collection grids / quick views / cart line items.
    var cards = root.querySelectorAll(settings.cardSelector);
    Array.prototype.forEach.call(cards, function (card) {
      var id = idFromCard(card);
      if (!id) return;
      var priceEl = card.querySelector(settings.priceSelector);
      if (!priceEl) return;
      if (priceEl.closest("[data-zikmetal-product]")) return;
      register(id, card, priceEl, null);
    });
  }

  /* ----------------------------------------------------------------------
   * Rendering
   * -------------------------------------------------------------------- */
  function renderProduct(productId) {
    var data = state.products[productId];
    var targets = state.registry[productId];
    if (!data || !targets || !state.rate) return;
    if (!data.enabled && !data.dynamicPricingEnabled) return; // leave theme price

    var attrs = data.attributes;
    var priceResult = attrs ? calculatePrice(attrs, state.rate.rate) : { finalPrice: data.price };
    var price = priceResult.finalPrice;
    if (!price || price <= 0) return;

    var currency = data.currencyCode || settings.currency;

    targets.forEach(function (t) {
      var base = t.basePrice != null ? t.basePrice : data.basePrice;
      t.amount.textContent = money(price, currency);
      t.amount.setAttribute("data-zikmetal-live", "1");

      // Strike-through compare at price or original.
      var strikePrice = priceResult.compareAtPrice || base;
      if (settings.showStrikethrough && strikePrice && Math.abs(strikePrice - price) > 0.5) {
        t.original.textContent = money(strikePrice, currency);
        t.original.hidden = false;
      } else {
        t.original.hidden = true;
      }

      // Savings / markup badge.
      var savingsBase = base || priceResult.compareAtPrice;
      if (settings.showSavings && savingsBase && savingsBase > 0 && Math.abs(savingsBase - price) > 0.5) {
        var diffPct = Math.round(((price - savingsBase) / savingsBase) * 100);
        if (diffPct < 0) {
          t.savings.textContent = "Save " + Math.abs(diffPct) + "%";
          t.savings.setAttribute("data-direction", "save");
        } else {
          t.savings.textContent = "Live +" + diffPct + "%";
          t.savings.setAttribute("data-direction", "up");
        }
        t.savings.hidden = false;
      } else {
        t.savings.hidden = true;
      }

      // Expose attributes for theming / status badges.
      if (attrs) {
        t.container.setAttribute("data-zikmetal-profit", attrs.profit_percent);
        t.container.setAttribute("data-zikmetal-weight", attrs.weight_grams);
      }
      var status = t.container.querySelector("[data-zikmetal-status]");
      if (status) status.hidden = false;
    });
  }

  function renderAll() {
    Object.keys(state.registry).forEach(renderProduct);
    syncAddToCartProps();
  }

  /* ----------------------------------------------------------------------
   * Add-to-cart — attach line item properties for transparency.
   * (The charged amount itself comes from the synced variant price.)
   * -------------------------------------------------------------------- */
  function setHidden(form, name, value) {
    var input = form.querySelector('input[name="' + name + '"][data-zikmetal]');
    if (!input) {
      input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.setAttribute("data-zikmetal", "1");
      form.appendChild(input);
    }
    input.value = value;
  }

  function syncAddToCartProps() {
    if (!window.ZikMetalCurrentProduct || !state.rate) return;
    var pid = String(window.ZikMetalCurrentProduct.id);
    var data = state.products[pid];
    if (!data || !(data.enabled || data.dynamicPricingEnabled) || !data.attributes) return;
    var priceResult = calculatePrice(data.attributes, state.rate.rate);

    var forms = document.querySelectorAll('form[action*="/cart/add"]');
    Array.prototype.forEach.call(forms, function (form) {
      setHidden(form, "properties[_zikmetal_silver_rate]", String(state.rate.rate));
      setHidden(form, "properties[_zikmetal_weight_g]", String(data.attributes.weight_grams));
      setHidden(form, "properties[_zikmetal_live_price]", String(priceResult.finalPrice));
    });
  }

  /* ----------------------------------------------------------------------
   * Cart re-pricing on cart events (best effort)
   * -------------------------------------------------------------------- */
  function rescanAndRender(root) {
    discover(root || document);
    var ids = Object.keys(state.pendingIds);
    if (!ids.length) {
      renderAll();
      return;
    }
    state.pendingIds = {};
    fetchPrices(ids).then(renderAll);
  }

  function hookCartEvents() {
    // Shopify theme cart events (Dawn + most OS 2.0 themes).
    document.addEventListener("cart:refresh", function () {
      setTimeout(function () { rescanAndRender(); }, 50);
    });
    document.addEventListener("cart:updated", function () {
      setTimeout(function () { rescanAndRender(); }, 50);
    });
    // Patch fetch to catch /cart/add, /cart/change, /cart/update and re-render.
    var origFetch = window.fetch;
    if (origFetch && !origFetch.__zikmetal) {
      var patched = function () {
        var args = arguments;
        var url = typeof args[0] === "string" ? args[0] : (args[0] && args[0].url) || "";
        return origFetch.apply(this, args).then(function (res) {
          if (/\/cart\/(add|change|update|clear)/.test(url)) {
            setTimeout(function () { rescanAndRender(); }, 80);
          }
          return res;
        });
      };
      patched.__zikmetal = true;
      window.fetch = patched;
    }
  }

  /* ----------------------------------------------------------------------
   * Boot + loops
   * -------------------------------------------------------------------- */
  function tickRate() {
    var prev = state.rate ? state.rate.rate : null;
    fetchRate().then(function (rate) {
      if (!rate) return;
      if (rate.rate !== prev) {
        log("rate changed", prev, "->", rate.rate);
        renderAll();
      }
    });
  }

  function start() {
    if (state.started) return;
    state.started = true;
    log("starting", { proxy: API, refresh: settings.refreshSeconds });

    discover(document);
    var ids = Object.keys(state.pendingIds);
    state.pendingIds = {};

    Promise.all([fetchSettings(), fetchRate(), fetchPrices(ids)]).then(function () {
      renderAll();
    });

    // Rate refresh loop — recomputes all prices locally on change.
    var ms = Math.max(5, Number(settings.refreshSeconds) || 30) * 1000;
    setInterval(tickRate, ms);

    // Periodic full re-scan for config/catalog changes (5× the rate interval).
    setInterval(function () {
      Object.keys(state.products).forEach(function (id) {
        delete state.products[id];
      });
      Object.keys(state.registry).forEach(function (id) {
        state.pendingIds[id] = true;
      });
      var pending = Object.keys(state.pendingIds);
      state.pendingIds = {};
      fetchPrices(pending).then(renderAll);
    }, ms * 5);

    hookCartEvents();

    // Observe DOM for AJAX-loaded content (infinite scroll, quick view, drawer).
    var debounceTimer = null;
    var observer = new MutationObserver(function (mutations) {
      var relevant = false;
      for (var i = 0; i < mutations.length; i++) {
        if (mutations[i].addedNodes && mutations[i].addedNodes.length) {
          relevant = true;
          break;
        }
      }
      if (!relevant) return;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () { rescanAndRender(); }, 150);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Public API.
  window.ZikMetal = {
    state: state,
    settings: settings,
    calculatePrice: calculatePrice,
    refresh: function () { rescanAndRender(); },
    rescan: rescanAndRender,
    money: money,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
