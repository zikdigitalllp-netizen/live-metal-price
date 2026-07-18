// @ts-check
import shopify from "../shopify.js";
import { fetchMCXSilverRate } from "./metals-api.js";
import { calculatePrice, resolveAttributes, calculateVariantPrices } from "./pricing.js";
import { getAllConfigs, getConfig, toNumericId, normalizeConfig } from "./product-config.js";

/**
 * Product catalog fields. We read core product data (title, image, base
 * price, variants) from the Admin API, plus zikmetal metafields.
 */
const PRODUCT_FIELDS = `
  id
  title
  handle
  status
  featuredImage { url altText }
  priceRangeV2 { minVariantPrice { amount currencyCode } }
  metafields(first: 20, namespace: "zikmetal") {
    edges {
      node {
        key
        value
        type
      }
    }
  }
  variants(first: 50) {
    edges { node { id title price } }
  }
`;

function firstVariant(product) {
  return product?.variants?.edges?.[0]?.node || null;
}

function buildRow(product, config, settings, silverRate) {
  const attrs = resolveAttributes(config, settings);
  const basePrice = parseFloat(product?.priceRangeV2?.minVariantPrice?.amount || "0");
  const currencyCode = product?.priceRangeV2?.minVariantPrice?.currencyCode || "INR";

  const variantNodes = (product?.variants?.edges || [])
    .map((e) => e?.node)
    .filter(Boolean);
  const variantIds = variantNodes.map((n) => n.id).filter(Boolean);
  const hasVariants = variantNodes.length > 1;

  let breakdown = null;
  let calculatedPrice = basePrice;
  let compareAtPrice = null;
  let variantPrices = [];

  if (attrs.dynamic_pricing_enabled) {
    breakdown = calculatePrice(
      attrs.weight_grams,
      silverRate,
      attrs.making_charge_per_gram,
      attrs.gst_percent,
      attrs.profit_percent,
      attrs.shipping_cost,
      attrs.compare_at_profit_percent
    );
    calculatedPrice = breakdown.finalPrice;
    compareAtPrice = breakdown.compareAtPrice;

    // Additive: independent per-variant pricing, only when the merchant has
    // opted a multi-variant product into weight-based or manual variant
    // pricing. Simple / unconfigured products fall straight through to the
    // single calculatedPrice/compareAtPrice above — unchanged.
    if (hasVariants && attrs.variant_pricing?.mode) {
      variantPrices = calculateVariantPrices(
        variantNodes.map((n) => ({ id: n.id, title: n.title })),
        attrs,
        silverRate,
        attrs.variant_pricing
      );
      // Keep the top-level calculatedPrice/compareAtPrice representative of
      // the base (first) variant, so list views and legacy consumers still
      // see a single sensible number.
      const base = variantPrices[0];
      if (base) {
        calculatedPrice = base.price;
        compareAtPrice = base.compareAtPrice;
      }
    }
  }

  const v = firstVariant(product);

  return {
    id: toNumericId(product.id),
    gid: product.id,
    title: product.title,
    handle: product.handle,
    status: product.status,
    image: product?.featuredImage?.url || null,
    currencyCode,
    basePrice,
    calculatedPrice,
    compareAtPrice,
    dynamicPricingEnabled: attrs.dynamic_pricing_enabled,
    weightGrams: attrs.weight_grams,
    makingChargePerGram: attrs.making_charge_per_gram,
    gstPercent: attrs.gst_percent,
    profitPercent: attrs.profit_percent,
    compareAtProfitPercent: attrs.compare_at_profit_percent,
    shippingCost: attrs.shipping_cost,
    attributes: attrs,
    breakdown,
    defaultVariantId: v?.id || null,
    defaultVariantPrice: v ? parseFloat(v.price) : basePrice,
    variantIds,
    // Additive fields for variant-pricing support:
    hasVariants,
    variantPricingMode: attrs.variant_pricing?.mode || null,
    variantPricing: attrs.variant_pricing || null,
    variantPrices, // [] unless a variant pricing mode is active
  };
}

/**
 * List products (first N) merged with app-stored pricing config + live prices.
 * @param {import("@shopify/shopify-api").Session} session
 * @param {object} settings
 * @param {{first?: number}} [opts]
 */
export async function fetchProductsWithPricing(session, settings, opts = {}) {
  const first = opts.first ?? 50;
  const client = new shopify.api.clients.Graphql({ session });

  const query = `
    query Products($first: Int!) {
      products(first: $first, sortKey: TITLE) {
        edges { node { ${PRODUCT_FIELDS} } }
      }
    }
  `;

  const [resp, silverRateData] = await Promise.all([
    client.request(query, { variables: { first } }),
    fetchMCXSilverRate(settings.metals_api_key || "", settings),
  ]);

  const products = (resp?.data?.products?.edges || []).map((e) => {
    const numeric = toNumericId(e.node.id);
    // Safe extraction
    const metafieldsEdges = e.node.metafields?.edges || [];
    const metafields = Array.isArray(metafieldsEdges) 
      ? metafieldsEdges.map(mf => mf?.node).filter(Boolean) 
      : [];
    const config = normalizeConfig(metafields);
    return buildRow(e.node, config, settings, silverRateData.rate);
  });

  return { products, silverRate: silverRateData };
}

/**
 * Compute live prices for an explicit set of product ids (numeric or GID),
 * batched into a single `nodes` query. Returns a per-id map suitable for the
 * storefront engine (price + attributes + breakdown), plus the live rate.
 * @param {import("@shopify/shopify-api").Session} session
 * @param {object} settings
 * @param {string[]} ids
 */
export async function fetchPricesForIds(session, settings, ids) {
  const client = new shopify.api.clients.Graphql({ session });

  const numericIds = ids.map(toNumericId);
  const gids = numericIds.map((id) => `gid://shopify/Product/${id}`);

  const query = `
    query Nodes($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product { ${PRODUCT_FIELDS} }
      }
    }
  `;

  const [resp, silverRateData] = await Promise.all([
    client.request(query, { variables: { ids: gids } }),
    fetchMCXSilverRate(settings.metals_api_key || "", settings),
  ]);

  const prices = {};
  for (const node of resp?.data?.nodes || []) {
    if (!node || !node.id) continue;
    const numeric = toNumericId(node.id);
    // Safe extraction
    const metafieldsEdges = node.metafields?.edges || [];
    const metafields = Array.isArray(metafieldsEdges) 
      ? metafieldsEdges.map(mf => mf?.node).filter(Boolean) 
      : [];
    const config = normalizeConfig(metafields);
    const row = buildRow(node, config, settings, silverRateData.rate);
    // Additive: variantId -> { price, compareAtPrice } map, only populated
    // when a variant pricing mode is active. Storefront falls back to the
    // single `price` field below when this is empty, so simple products and
    // untouched multi-variant products behave exactly as before.
    const variants = {};
    for (const vp of row.variantPrices) {
      variants[vp.variantId] = { price: vp.price, compareAtPrice: vp.compareAtPrice };
    }
    prices[numeric] = {
      dynamicPricingEnabled: row.dynamicPricingEnabled,
      price: row.dynamicPricingEnabled ? row.calculatedPrice : null,
      compareAtPrice: row.dynamicPricingEnabled ? row.compareAtPrice : null,
      basePrice: row.basePrice,
      currencyCode: row.currencyCode,
      attributes: row.attributes,
      breakdown: row.breakdown,
      defaultVariantId: row.defaultVariantId,
      variants, // {} unless variant pricing is active
    };
  }

  return { prices, silverRate: silverRateData };
}

/**
 * Get a single product with pricing data for syncing.
 * @param {import("@shopify/shopify-api").Session} session
 * @param {object} settings
 * @param {string} productId Numeric product ID
 */
export async function fetchSingleSyncTarget(session, settings, productId) {
  const client = new shopify.api.clients.Graphql({ session });
  const gid = `gid://shopify/Product/${toNumericId(productId)}`;
  
  const query = `
    query Product($id: ID!) {
      product(id: $id) { ${PRODUCT_FIELDS} }
    }
  `;
  
  const [resp, silverRateData] = await Promise.all([
    client.request(query, { variables: { id: gid } }),
    fetchMCXSilverRate(settings.metals_api_key || "", settings),
  ]);
  
  if (!resp?.data?.product) return null;
  
  // Safe extraction
  const metafieldsEdges = resp.data.product.metafields?.edges || [];
  const metafields = Array.isArray(metafieldsEdges) 
    ? metafieldsEdges.map(mf => mf?.node).filter(Boolean) 
    : [];
  const config = normalizeConfig(metafields);
  const row = buildRow(resp.data.product, config, settings, silverRateData.rate);
  if (!row.dynamicPricingEnabled || row.calculatedPrice <= 0) return null;
  
  return row;
}

/**
 * Build the data the price-sync service needs: every enabled product with its
 * variants and the computed final price. Used to push prices into Shopify so
 * cart / checkout reflect the calculated value.
 * @param {import("@shopify/shopify-api").Session} session
 * @param {object} settings
 */
export async function fetchSyncTargets(session, settings) {
  const { products, silverRate } = await fetchProductsWithPricing(session, settings, {
    first: 250,
  });
  const enabled = products.filter((p) => p.dynamicPricingEnabled && p.calculatedPrice > 0);
  return { targets: enabled, silverRate };
}

/**
 * Fetch a single product's variants (id, title, current Shopify price) plus
 * its stored variant_pricing config and a computed preview — used by the
 * admin "Configure variants" screen. Read-only; does not touch Shopify data.
 * @param {import("@shopify/shopify-api").Session} session
 * @param {object} settings
 * @param {string} productId
 */
export async function fetchVariantPricingView(session, settings, productId) {
  const client = new shopify.api.clients.Graphql({ session });
  const gid = `gid://shopify/Product/${toNumericId(productId)}`;

  const query = `
    query Product($id: ID!) {
      product(id: $id) {
        id
        title
        metafields(first: 20, namespace: "zikmetal") {
          edges { node { key value type } }
        }
        variants(first: 100) {
          edges { node { id title price selectedOptions { name value } } }
        }
      }
    }
  `;

  const [resp, silverRateData] = await Promise.all([
    client.request(query, { variables: { id: gid } }),
    fetchMCXSilverRate(settings.metals_api_key || "", settings),
  ]);

  const product = resp?.data?.product;
  if (!product) return null;

  const metafieldsEdges = product.metafields?.edges || [];
  const metafields = Array.isArray(metafieldsEdges)
    ? metafieldsEdges.map((e) => e?.node).filter(Boolean)
    : [];
  const config = normalizeConfig(metafields);
  const attrs = resolveAttributes(config, settings);

  const variantNodes = (product.variants?.edges || []).map((e) => e?.node).filter(Boolean);
  const variants = variantNodes.map((n) => ({
    id: n.id,
    title: n.title,
    currentPrice: parseFloat(n.price),
    selectedOptions: n.selectedOptions || [],
  }));

  let preview = [];
  if (attrs.dynamic_pricing_enabled && variants.length > 1 && attrs.variant_pricing?.mode) {
    preview = calculateVariantPrices(
      variantNodes.map((n) => ({ id: n.id, title: n.title })),
      attrs,
      silverRateData.rate,
      attrs.variant_pricing
    );
  }

  return {
    productId: toNumericId(product.id),
    title: product.title,
    hasVariants: variants.length > 1,
    variants,
    attributes: attrs,
    variantPricing: attrs.variant_pricing || null,
    preview,
    silverRate: silverRateData,
  };
}

export { getConfig };
