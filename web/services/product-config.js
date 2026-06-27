// @ts-check
import shopify from "../shopify.js";

/**
 * Per-product pricing attributes, stored in Shopify Product Metafields
 * with namespace "zikmetal".
 *
 * Stored shape:
 *   {
 *     dynamic_pricing_enabled: boolean,
 *     weight_grams: number,
 *     making_charge_per_gram: number,
 *     gst_percent: number,
 *     profit_percent: number,
 *     compare_at_profit_percent: number,
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

// Normalize a config object (from patch or existing data)
function normalizeConfigObject(obj) {
  const config = obj || {};
  return {
    dynamic_pricing_enabled: config.dynamic_pricing_enabled === true || config.dynamic_pricing_enabled === "true",
    weight_grams: Number(config.weight_grams) || 0,
    making_charge_per_gram: Number(config.making_charge_per_gram) || 0,
    gst_percent: config.gst_percent === undefined || config.gst_percent === "" || config.gst_percent === null ? null : Number(config.gst_percent),
    profit_percent: config.profit_percent === undefined || config.profit_percent === "" || config.profit_percent === null ? null : Number(config.profit_percent),
    compare_at_profit_percent: config.compare_at_profit_percent === undefined || config.compare_at_profit_percent === "" || config.compare_at_profit_percent === null ? null : Number(config.compare_at_profit_percent),
    shipping_cost: config.shipping_cost === undefined || config.shipping_cost === "" || config.shipping_cost === null ? null : Number(config.shipping_cost),
  };
}

// Normalize from metafields array
export function normalizeConfig(metafields) {
  // Ensure metafields is always an array
  const safeMetafields = Array.isArray(metafields) ? metafields : [];
  
  // Convert metafields array to object
  const mfObj = {};
  for (const mf of safeMetafields) {
    if (!mf?.key) continue;
    mfObj[mf.key] = mf.value;
  }

  // Use the same normalization for consistency
  return normalizeConfigObject(mfObj);
}

/** Helper to load all products with zikmetal metafields for a shop */
async function loadShopFromMetafields(session) {
  const shop = shopOf(session);
  const map = new Map();
  const client = new shopify.api.clients.Graphql({ session });

  try {
    // Fetch all products with their zikmetal metafields
    let hasNext = true;
    let cursor = null;

    while (hasNext) {
      const query = `
        query Products($first: Int!, $after: String) {
          products(first: $first, after: $after) {
            edges {
              cursor
              node {
                id
                metafields(first: 20, namespace: "zikmetal") {
                  edges {
                    node {
                      key
                      value
                      type
                    }
                  }
                }
              }
            }
            pageInfo { hasNextPage }
          }
        }
      `;

      const resp = await client.request(query, {
        variables: { first: 100, after: cursor },
      });

      const products = resp?.data?.products?.edges || [];

      for (const edge of products) {
        if (!edge?.node?.id) continue;
        const numericId = toNumericId(edge.node.id);
        // Safe extraction of metafields
        const metafieldsEdges = edge.node.metafields?.edges || [];
        const metafields = Array.isArray(metafieldsEdges) 
          ? metafieldsEdges.map(e => e?.node).filter(Boolean) 
          : [];
        map.set(numericId, normalizeConfig(metafields));
      }

      hasNext = resp?.data?.products?.pageInfo?.hasNextPage || false;
      cursor = products.length > 0 ? products[products.length - 1].cursor : null;
    }
  } catch (error) {
    console.error("[product-config] load from metafields failed:", error.message);
  }

  cache.set(shop, map);
  return map;
}

/** Get the raw stored config for a single product (or null if none). */
export async function getConfig(session, productId) {
  const shop = shopOf(session);
  let map = cache.get(shop);

  if (!map) {
    map = await loadShopFromMetafields(session);
  }

  if (map.has(toNumericId(productId))) {
    return map.get(toNumericId(productId));
  }

  // Fetch single product if not in cache
  try {
    const client = new shopify.api.clients.Graphql({ session });
    const gid = `gid://shopify/Product/${toNumericId(productId)}`;
    const query = `
      query Product($id: ID!) {
        product(id: $id) {
          id
          metafields(first: 20, namespace: "zikmetal") {
            edges {
              node {
                key
                value
                type
              }
            }
          }
        }
      }
    `;

    const resp = await client.request(query, { variables: { id: gid } });      
    // Safe extraction of metafields
    const metafieldsEdges = resp?.data?.product?.metafields?.edges || [];
    const metafields = Array.isArray(metafieldsEdges) 
      ? metafieldsEdges.map(e => e?.node).filter(Boolean) 
      : [];
    const config = normalizeConfig(metafields);
    map.set(toNumericId(productId), config);
    return config;
  } catch (error) {
    console.error("[product-config] get single config failed:", error.message);
    return null;
  }
}

/** Get all stored configs for a shop as a plain object keyed by numeric id. */
export async function getAllConfigs(session) {
  const shop = shopOf(session);
  const map = await loadShopFromMetafields(session);
  return Object.fromEntries(map.entries());
}

/** Numeric ids of products that currently have dynamic pricing enabled. */
export async function getEnabledIds(session) {
  const shop = shopOf(session);
  const map = await loadShopFromMetafields(session);
  const ids = [];
  for (const [id, cfg] of map.entries()) {
    if (cfg.dynamic_pricing_enabled) ids.push(id);
  }
  return ids;
}

/** Upsert a product's config into Shopify Product Metafields and refresh the cache. */
export async function saveConfig(session, productId, patch) {
  const shop = shopOf(session);
  if (!shop) throw new Error("Cannot save product config without a shop");
  const id = toNumericId(productId);
  const gid = `gid://shopify/Product/${id}`;

  let map = cache.get(shop);
  if (!map) {
    map = await loadShopFromMetafields(session);
  }

  const current = map.get(id) || {};
  const next = normalizeConfigObject({
    ...current,
    ...patch,
  });

  try {
    const client = new shopify.api.clients.Graphql({ session });

    // Build metafields for metafieldsSet - use single_line_text for compatibility
    const metafields = [
      {
        namespace: "zikmetal",
        key: "dynamic_pricing_enabled",
        value: next.dynamic_pricing_enabled ? "true" : "false",
        type: "boolean",
        ownerId: gid,
      },
      {
        namespace: "zikmetal",
        key: "weight_grams",
        value: String(next.weight_grams),
        type: "number_decimal",
        ownerId: gid,
      },
      {
        namespace: "zikmetal",
        key: "making_charge_per_gram",
        value: String(next.making_charge_per_gram),
        type: "number_decimal",
        ownerId: gid,
      },
      {
        namespace: "zikmetal",
        key: "gst_percent",
        value: next.gst_percent !== null ? String(next.gst_percent) : "0",
        type: "number_decimal",
        ownerId: gid,
      },
      {
        namespace: "zikmetal",
        key: "profit_percent",
        value: next.profit_percent !== null ? String(next.profit_percent) : "0",
        type: "number_decimal",
        ownerId: gid,
      },
      {
        namespace: "zikmetal",
        key: "compare_at_profit_percent",
        value: next.compare_at_profit_percent !== null ? String(next.compare_at_profit_percent) : "0",
        type: "number_decimal",
        ownerId: gid,
      },
      {
        namespace: "zikmetal",
        key: "shipping_cost",
        value: next.shipping_cost !== null ? String(next.shipping_cost) : "0",
        type: "number_decimal",
        ownerId: gid,
      },
    ];

    console.log("[product-config] Saving metafields:", JSON.stringify(metafields, null, 2));

    const mutation = `
      mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id key value namespace type }
          userErrors { field message code }
        }
      }
    `;

    const resp = await client.request(mutation, { variables: { metafields } });
    console.log("[product-config] metafieldsSet response:", JSON.stringify(resp, null, 2));

    const userErrors = resp?.data?.metafieldsSet?.userErrors || [];
    if (userErrors.length > 0) {
      console.error("[product-config] saveConfig user errors:", userErrors);
      throw new Error(userErrors.map(e => `${e.field || 'unknown'}: ${e.message} (code: ${e.code})`).join(", "));
    }

    // Update cache
    map.set(id, next);
    cache.set(shop, map);

    return next;
  } catch (error) {
    console.error("[product-config] saveConfig failed:", error);
    throw error;
  }
}

/** Drop the in-memory cache for a shop (used on uninstall). */
export function clearConfigCache(shop) {
  cache.delete(shop);
}
