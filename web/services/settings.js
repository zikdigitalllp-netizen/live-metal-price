// @ts-check
import db, { ready } from "./db.js";

/**
 * App-wide settings, stored in the app's own SQLite table (NOT a shop
 * metafield). One JSON row per shop, with a small in-memory cache so storefront
 * App-Proxy calls stay fast.
 */

export const DEFAULT_SETTINGS = Object.freeze({
  metals_api_key: "",
  custom_silver_price: null,
  use_custom_silver_price: false,
  default_weight_grams: 0,
  default_making_charge_per_gram: 0,
  default_gst_percent: 3,
  default_profit_percent: 24,
  default_compare_at_profit_percent: 24,
  default_shipping_cost: 100,
  refresh_interval_seconds: 14400, // 4 hours
  show_strikethrough: true,
  show_savings: true,
  auto_sync_on_refresh: true,
  last_sync_time: null,
  last_price_sync_time: null,
});

/** @type {Map<string, any>} */
const settingsCache = new Map();

function shopOf(sessionOrShop) {
  return typeof sessionOrShop === "string" ? sessionOrShop : sessionOrShop?.shop;
}

function normalize(raw) {
  const bool = (v, d) => (v === undefined || v === null ? d : v === true || v === "true");
  const customSilverPrice = raw?.custom_silver_price !== undefined && raw?.custom_silver_price !== null && raw?.custom_silver_price !== "" ? Number(raw.custom_silver_price) : null;
  return {
    metals_api_key: String(raw?.metals_api_key ?? DEFAULT_SETTINGS.metals_api_key),
    custom_silver_price: customSilverPrice,
    use_custom_silver_price: bool(raw?.use_custom_silver_price, DEFAULT_SETTINGS.use_custom_silver_price),
    default_weight_grams: Number(raw?.default_weight_grams ?? DEFAULT_SETTINGS.default_weight_grams) || 0,
    default_making_charge_per_gram:
      Number(raw?.default_making_charge_per_gram ?? DEFAULT_SETTINGS.default_making_charge_per_gram) || 0,
    default_gst_percent: Number(raw?.default_gst_percent ?? DEFAULT_SETTINGS.default_gst_percent),
    default_profit_percent: Number(raw?.default_profit_percent ?? DEFAULT_SETTINGS.default_profit_percent),
    default_compare_at_profit_percent: Number(raw?.default_compare_at_profit_percent ?? DEFAULT_SETTINGS.default_compare_at_profit_percent),
    default_shipping_cost: Number(raw?.default_shipping_cost ?? DEFAULT_SETTINGS.default_shipping_cost),
    refresh_interval_seconds: Number(raw?.refresh_interval_seconds ?? DEFAULT_SETTINGS.refresh_interval_seconds) || 14400,
    show_strikethrough: bool(raw?.show_strikethrough, DEFAULT_SETTINGS.show_strikethrough),
    show_savings: bool(raw?.show_savings, DEFAULT_SETTINGS.show_savings),
    auto_sync_on_refresh: bool(raw?.auto_sync_on_refresh, DEFAULT_SETTINGS.auto_sync_on_refresh),
    last_sync_time: raw?.last_sync_time ?? null,
    last_price_sync_time: raw?.last_price_sync_time ?? null,
  };
}

/**
 * Read settings for a shop (cache → SQLite → defaults).
 * @param {import("@shopify/shopify-api").Session | string} sessionOrShop
 */
export async function getSettings(sessionOrShop) {
  const shop = shopOf(sessionOrShop);
  if (!shop) return { ...DEFAULT_SETTINGS };
  if (settingsCache.has(shop)) return settingsCache.get(shop);

  await ready();
  let value = { ...DEFAULT_SETTINGS };
  try {
    const row = await db.get(`SELECT data FROM zikmetal_settings WHERE shop = ?`, [shop]);
    if (row?.data) value = normalize(JSON.parse(row.data));
  } catch (error) {
    console.error("[settings] load failed:", error.message);
  }
  settingsCache.set(shop, value);
  return value;
}

/**
 * Persist a settings patch for a shop and refresh the cache.
 * @param {import("@shopify/shopify-api").Session | string} sessionOrShop
 * @param {Record<string, any>} patch
 */
export async function saveSettings(sessionOrShop, patch) {
  const shop = shopOf(sessionOrShop);
  if (!shop) throw new Error("Cannot save settings without a shop");

  const current = await getSettings(shop);
  const next = normalize({ ...current, ...patch });

  await ready();
  await db.run(
    `INSERT INTO zikmetal_settings (shop, data, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(shop) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    [shop, JSON.stringify(next), new Date().toISOString()]
  );

  settingsCache.set(shop, next);
  return next;
}

/** Record the last successful silver-rate sync time. */
export async function touchLastSync(sessionOrShop) {
  return saveSettings(sessionOrShop, { last_sync_time: new Date().toISOString() });
}

/** Drop the in-memory cache for a shop (used on uninstall). */
export function clearSettingsCache(shop) {
  settingsCache.delete(shop);
}
