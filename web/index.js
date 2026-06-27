// @ts-check
import { join } from "path";
import { readFileSync } from "fs";
import express from "express";
import serveStatic from "serve-static";

import shopify from "./shopify.js";
import productCreator from "./product-creator.js";
import WebhookHandlers from "./webhooks.js";
import proxyRouter from "./proxy.js";

import { ready as dbReady, db } from "./services/db.js";
import { fetchMCXSilverRate, invalidateCache, istSlot } from "./services/metals-api.js";
import { calculatePrice } from "./services/pricing.js";
import {
  fetchProductsWithPricing,
  fetchPricesForIds,
} from "./services/product-pricing.js";
import {
  getConfig,
  getAllConfigs,
  saveConfig,
} from "./services/product-config.js";
import {
  getSettings,
  saveSettings,
  touchLastSync,
} from "./services/settings.js";
import { syncPricesToShopify } from "./services/price-sync.js";
import { loadOfflineSession } from "./services/proxy-auth.js";

const PORT = parseInt(process.env.BACKEND_PORT || process.env.PORT || "3000", 10);

const STATIC_PATH =
  process.env.NODE_ENV === "production"
    ? `${process.cwd()}/frontend/dist`
    : `${process.cwd()}/frontend/`;

const app = express();

/* --------------------------------------------------------------------------
 * Auth
 * ------------------------------------------------------------------------ */
app.get(shopify.config.auth.path, shopify.auth.begin());
app.get(
  shopify.config.auth.callbackPath,
  shopify.auth.callback(),
  async (req, res, next) => {
    // afterAuth: ensure the app's own tables exist and warm the settings cache.
    // ZikMetal stores all pricing data in its own SQLite tables — no metafield
    // definitions to register.
    try {
      await dbReady();
      await getSettings(res.locals.shopify.session);
    } catch (error) {
      console.error("[afterAuth] provisioning error:", error.message);
    }
    next();
  },
  shopify.redirectToShopifyOrAppRoot()
);

/* --------------------------------------------------------------------------
 * Webhooks
 * ------------------------------------------------------------------------ */
app.post(
  shopify.config.webhooks.path,
  shopify.processWebhooks({ webhookHandlers: WebhookHandlers })
);

/* --------------------------------------------------------------------------
 * Public storefront endpoints (App Proxy, HMAC-verified, no session cookie)
 * Mounted BEFORE the authenticated-session gate.
 * ------------------------------------------------------------------------ */
app.use("/proxy", proxyRouter);

/* --------------------------------------------------------------------------
 * Authenticated Admin API
 * ------------------------------------------------------------------------ */
app.use("/api/*", shopify.validateAuthenticatedSession());
app.use(express.json());

const session = (res) => res.locals.shopify.session;

// --- Silver rate ----------------------------------------------------------
app.get("/api/mcx-rate", async (_req, res) => {
  try {
    const settings = await getSettings(session(res));
    const rateData = await fetchMCXSilverRate(settings.metals_api_key || "", settings);
    res.status(200).json(rateData);
  } catch (error) {
    console.error("Error fetching MCX rate:", error.message);
    res.status(500).json({ error: "Failed to fetch MCX rate" });
  }
});

app.post("/api/mcx-rate/refresh", async (_req, res) => {
  try {
    invalidateCache();
    const settings = await getSettings(session(res));
    const rateData = await fetchMCXSilverRate(settings.metals_api_key || "", settings);
    await touchLastSync(session(res));

    // Optionally push fresh prices to Shopify so cart/checkout stay in sync.
    let sync = null;
    if (settings.auto_sync_on_refresh) {
      try {
        sync = await syncPricesToShopify(session(res), settings);
      } catch (e) {
        console.error("[refresh] auto-sync failed:", e.message);
      }
    }
    res.status(200).json({ ...rateData, sync });
  } catch (error) {
    console.error("Error refreshing MCX rate:", error.message);
    res.status(500).json({ error: "Failed to refresh MCX rate" });
  }
});

app.post("/api/test-api", async (req, res) => {
  try {
    const { api_key } = req.body;
    invalidateCache();
    const rateData = await fetchMCXSilverRate(api_key);
    res.status(200).json({ success: true, rateData, slot: istSlot() });
  } catch (error) {
    console.error("API test failed:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- Products -------------------------------------------------------------
app.get("/api/products/count", async (_req, res) => {
  try {
    const client = new shopify.api.clients.Graphql({ session: session(res) });
    const countData = await client.request(`query { productsCount { count } }`);
    res.status(200).json({ count: countData.data.productsCount.count });
  } catch (error) {
    console.error("Error counting products:", error.message);
    res.status(500).json({ error: "Failed to count products" });
  }
});

app.get("/api/products/dynamic-pricing", async (_req, res) => {
  try {
    const settings = await getSettings(session(res));
    const data = await fetchProductsWithPricing(session(res), settings, {
      first: 100,
    });
    res.status(200).json(data);
  } catch (error) {
    console.error("Error fetching products:", error.message);
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

app.get("/api/product/:id/price", async (req, res) => {
  try {
    const settings = await getSettings(session(res));
    const { prices, silverRate } = await fetchPricesForIds(session(res), settings, [
      req.params.id,
    ]);
    const entry = prices[req.params.id] || {
      dynamicPricingEnabled: false,
      price: null,
    };
    res.status(200).json({ productId: req.params.id, ...entry, silverRate });
  } catch (error) {
    console.error("Error fetching product price:", error.message);
    res.status(500).json({ error: "Failed to fetch price" });
  }
});

app.get("/api/products/prices", async (req, res) => {
  try {
    const idsParam = String(req.query.ids || "");
    if (!idsParam) {
      return res.status(400).json({ error: "ids query parameter is required" });
    }
    const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean);
    const settings = await getSettings(session(res));
    const data = await fetchPricesForIds(session(res), settings, ids);
    res.status(200).json(data);
  } catch (error) {
    console.error("Error fetching bulk prices:", error.message);
    res.status(500).json({ error: "Failed to fetch prices" });
  }
});

// --- Per-product config (stored in Shopify Product Metafields) -------
app.get("/api/product/:id/config", async (req, res) => {
  try {
    const config = await getConfig(session(res), req.params.id);
    res.status(200).json({ productId: req.params.id, config });
  } catch (error) {
    console.error("Error reading product config:", error.message);
    res.status(500).json({ error: "Failed to read config" });
  }
});

app.put("/api/product/:id/config", async (req, res) => {
  try {
    const saved = await saveConfig(session(res), req.params.id, req.body || {});
    res.status(200).json({ success: true, config: saved });
  } catch (error) {
    console.error("Error updating product config:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/configs", async (_req, res) => {
  try {
    const configs = await getAllConfigs(session(res));
    res.status(200).json({ configs });
  } catch (error) {
    res.status(500).json({ error: "Failed to read configs" });
  }
});

// --- Price sync (push computed prices into Shopify variant prices) ---------
app.post("/api/sync-prices", async (_req, res) => {
  try {
    const settings = await getSettings(session(res));
    const result = await syncPricesToShopify(session(res), settings);
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error("Error syncing prices:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- Settings -------------------------------------------------------------
app.get("/api/settings", async (_req, res) => {
  try {
    const settings = await getSettings(session(res));
    res.status(200).json(settings);
  } catch (error) {
    console.error("Error reading settings:", error.message);
    res.status(500).json({ error: "Failed to read settings" });
  }
});

app.put("/api/settings", async (req, res) => {
  try {
    const settings = await saveSettings(session(res), req.body || {});
    res.status(200).json(settings);
  } catch (error) {
    console.error("Error saving settings:", error.message);
    res.status(500).json({ error: "Failed to save settings" });
  }
});

// --- Dev helper: create sample products -----------------------------------
app.post("/api/products", async (_req, res) => {
  let status = 200;
  let error = null;
  try {
    await productCreator(session(res));
  } catch (e) {
    console.log(`Failed to create products: ${e.message}`);
    status = 500;
    error = e.message;
  }
  res.status(status).send({ success: status === 200, error });
});

// --- Price preview (no Shopify call) --------------------------------------
app.post("/api/price-preview", async (req, res) => {
  try {
    const b = req.body || {};
    const settings = await getSettings(session(res));
    const rate =
      b.silver_rate ??
      (await fetchMCXSilverRate(settings.metals_api_key || "", settings)).rate;
    const breakdown = calculatePrice(
      b.weight_grams,
      rate,
      b.making_charge_per_gram,
      b.gst_percent,
      b.profit_percent,
      b.shipping_cost,
      b.compare_at_profit_percent
    );
    res.status(200).json({ silverRate: rate, breakdown });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* --------------------------------------------------------------------------
 * Frontend (embedded admin)
 * ------------------------------------------------------------------------ */
app.use(shopify.cspHeaders());
app.use(serveStatic(STATIC_PATH, { index: false }));

app.use("/*", shopify.ensureInstalledOnShop(), async (_req, res) => {
  return res
    .status(200)
    .set("Content-Type", "text/html")
    .send(
      readFileSync(join(STATIC_PATH, "index.html"))
        .toString()
        .replace("%VITE_SHOPIFY_API_KEY%", process.env.SHOPIFY_API_KEY || "")
    );
});

/**
 * Background job to auto-refresh silver rate and sync prices for all shops
 */
async function runBackgroundSync() {
  try {
    // Get all shops that have settings
    const shopRows = await db.all(`SELECT shop FROM zikmetal_settings`);
    for (const row of shopRows) {
      const shop = row.shop;
      try {
        const session = await loadOfflineSession(shop);
        const settings = await getSettings(session);
        
        // Refresh silver rate
        invalidateCache();
        const rateData = await fetchMCXSilverRate(settings.metals_api_key || "", settings);
        await touchLastSync(session);
        
        // Auto-sync prices if enabled
        if (settings.auto_sync_on_refresh) {
          try {
            await syncPricesToShopify(session, settings);
            console.log(`[bg-sync] Successfully synced prices for ${shop}`);
          } catch (e) {
            console.error(`[bg-sync] Failed to sync prices for ${shop}:`, e.message);
          }
        }
      } catch (e) {
        console.error(`[bg-sync] Error processing shop ${shop}:`, e.message);
      }
    }
  } catch (e) {
    console.error("[bg-sync] Error in background sync:", e.message);
  }
}

// Ensure tables exist before we start taking traffic. On serverless platforms
// (e.g. Vercel) the table creation also happens lazily inside every DB call, so
// we only bind a port when running as a normal long-lived server.
if (!process.env.VERCEL) {
  dbReady()
    .catch((e) => console.error("[db] init error:", e.message))
    .finally(() => {
      app.listen(PORT, () => {
        console.log(`ZikMetal backend listening on :${PORT}`);
        
        // Start background sync every 4 hours
        const refreshIntervalMs = 4 * 60 * 60 * 1000;
        setInterval(runBackgroundSync, refreshIntervalMs);
        console.log(`[bg-sync] Started background sync, running every ${refreshIntervalMs / 1000}s`);
        
        // Run first sync immediately
        runBackgroundSync();
      });
    });
}

export default app;
