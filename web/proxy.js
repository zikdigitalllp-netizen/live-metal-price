// @ts-check
import express from "express";
import { verifyAppProxy, loadOfflineSession } from "./services/proxy-auth.js";
import { getSettings } from "./services/settings.js";
import { fetchMCXSilverRate } from "./services/metals-api.js";
import { fetchPricesForIds } from "./services/product-pricing.js";

/**
 * Storefront-facing endpoints exposed through the Shopify App Proxy.
 *
 * Mapping (configured in shopify.app.toml):
 *   https://{shop}/apps/zikmetal-live-price/api/*  ->  /proxy/api/*
 *
 * All routes are HMAC-verified and use the shop's offline session to read the
 * Admin API. Responses are CORS-free (same-origin to the storefront) and
 * cache-busting on the client side.
 */
const router = express.Router();

router.use(verifyAppProxy);

// Always return JSON for proxy responses.
router.use((_req, res, next) => {
  res.set("Content-Type", "application/json; charset=utf-8");
  res.set("Cache-Control", "no-store");
  next();
});

// GET /proxy/api/mcx-rate
router.get("/api/mcx-rate", async (req, res) => {
  try {
    const session = await loadOfflineSession(req.proxyShop);
    const settings = await getSettings(session);
    const rate = await fetchMCXSilverRate(settings.metals_api_key || "", settings);
    res.status(200).json({ silverRate: rate });
  } catch (error) {
    console.error("[proxy] mcx-rate:", error.message);
    res.status(500).json({ error: "Failed to fetch rate" });
  }
});

// GET /proxy/api/settings  (display flags only — safe to expose publicly)
router.get("/api/settings", async (req, res) => {
  try {
    const session = await loadOfflineSession(req.proxyShop);
    const s = await getSettings(session);
    res.status(200).json({
      refreshSeconds: s.refresh_interval_seconds,
      showStrikethrough: s.show_strikethrough,
      showSavings: s.show_savings,
    });
  } catch (error) {
    console.error("[proxy] settings:", error.message);
    res.status(500).json({ error: "Failed to fetch settings" });
  }
});

// GET /proxy/api/product/:id/price
router.get("/api/product/:id/price", async (req, res) => {
  try {
    const session = await loadOfflineSession(req.proxyShop);
    const settings = await getSettings(session);
    const { prices, silverRate } = await fetchPricesForIds(session, settings, [
      req.params.id,
    ]);
    const entry = prices[req.params.id] || {
      dynamicPricingEnabled: false,
      price: null,
    };
    res.status(200).json({
      productId: req.params.id,
      ...entry,
      silverRate,
    });
  } catch (error) {
    console.error("[proxy] product price:", error.message);
    res.status(500).json({ error: "Failed to fetch price" });
  }
});

// GET /proxy/api/products/prices?ids=1,2,3
router.get("/api/products/prices", async (req, res) => {
  try {
    const idsParam = String(req.query.ids || "");
    if (!idsParam) {
      return res.status(400).json({ error: "ids query parameter is required" });
    }
    const ids = idsParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 250);

    const session = await loadOfflineSession(req.proxyShop);
    const settings = await getSettings(session);
    const { prices, silverRate } = await fetchPricesForIds(session, settings, ids);
    res.status(200).json({ prices, silverRate });
  } catch (error) {
    console.error("[proxy] bulk prices:", error.message);
    res.status(500).json({ error: "Failed to fetch prices" });
  }
});

export default router;
