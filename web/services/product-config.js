// @ts-check
import db, { ready } from "./db.js";

/**
 * Per-product pricing attributes, stored in the app's own SQLite table — NOT in
 * Shopify product metafields. The app is the single source of truth for every
 * product's weight, making charge, GST, profit and shipping.
 *
 * Stored shape (JSON per product):
 *   {
 *     dynamic_pricing_enabled: boolean,
 *     weight_grams: number,
 *     making_charge_per_gram: number,
 *     gst_percent: number,
 *     profit_percent: number,
 *     shipping_cost: number
 *   }
 */

/** @type {Map<string, Map<string, any>>} */
const cache = new Map(); // shop -> (productId -> config)

function shopOf(s) {
  return typeof s === "string" ? s : s?.shop;
}

/** Normalise a numeric product id out of a GID or raw value. */
export function toNumericId(id) {
  const s = String(id ?? "");
  const m = s.match(/(\d+)$/);
  return m ? m[1] : s;
}

function normalizeConfig(raw) {
  return {
    dynamic_pricing_enabled:
      raw?.dynamic_pricing_enabled === true || raw?.dynamic_pricing_enabled === "true",
    weight_grams: Number(raw?.weight_grams) || 0,
    making_charge_per_gram: Number(raw?.making_charge_per_gram) || 0,
    gst_percent: raw?.gst_percent === undefined || raw?.gst_percent === "" ? null : Number(raw.gst_percent),
    profit_percent:
      raw?.profit_percent === undefined || raw?.profit_percent === "" ? null : Number(raw.profit_percent),
    compare_at_profit_percent:
      raw?.compare_at_profit_percent === undefined || raw?.compare_at_profit_percent === "" ? null : Number(raw.compare_at_profit_percent),
    shipping_cost:
      raw?.shipping_cost === undefined || raw?.shipping_cost === "" ? null : Number(raw.shipping_cost),
  };
}

async function loadShop(shop) {
  if (cache.has(shop)) return cache.get(shop);
  await ready();
  const map = new Map();
  try {
    const rows = await db.all(
      `SELECT product_id, data FROM zikmetal_product_config WHERE shop = ?`,
      [shop]
    );
    for (const row of rows) {
      try {
        map.set(String(row.product_id), normalizeConfig(JSON.parse(row.data)));
      } catch {
        /* skip corrupt row */
      }
    }
  } catch (error) {
    console.error("[product-config] load failed:", error.message);
  }
  cache.set(shop, map);
  return map;
}

/** Get the raw stored config for a single product (or null if none). */
export async function getConfig(sessionOrShop, productId) {
  const shop = shopOf(sessionOrShop);
  const map = await loadShop(shop);
  return map.get(toNumericId(productId)) || null;
}

/** Get all stored configs for a shop as a plain object keyed by numeric id. */
export async function getAllConfigs(sessionOrShop) {
  const shop = shopOf(sessionOrShop);
  const map = await loadShop(shop);
  return Object.fromEntries(map.entries());
}

/** Numeric ids of products that currently have dynamic pricing enabled. */
export async function getEnabledIds(sessionOrShop) {
  const shop = shopOf(sessionOrShop);
  const map = await loadShop(shop);
  const ids = [];
  for (const [id, cfg] of map.entries()) {
    if (cfg.dynamic_pricing_enabled) ids.push(id);
  }
  return ids;
}

/** Upsert a product's config and refresh the cache. */
export async function saveConfig(sessionOrShop, productId, patch) {
  const shop = shopOf(sessionOrShop);
  if (!shop) throw new Error("Cannot save product config without a shop");
  const id = toNumericId(productId);

  const map = await loadShop(shop);
  const next = normalizeConfig({ ...(map.get(id) || {}), ...patch });

  await ready();
  await db.run(
    `INSERT INTO zikmetal_product_config (shop, product_id, data, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(shop, product_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    [shop, id, JSON.stringify(next), new Date().toISOString()]
  );

  map.set(id, next);
  return next;
}

/** Drop the in-memory cache for a shop (used on uninstall). */
export function clearConfigCache(shop) {
  cache.delete(shop);
}
