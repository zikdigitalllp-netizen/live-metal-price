// @ts-check

/**
 * New ZikMetal pricing formula. This is the single source of truth!
 *
 * Step 1: Metal Value = Live Silver Price × Weight (grams)
 * Step 2: Vendor Cost = Metal Value + Making Charges
 * Step 3: Profit Amount = Vendor Cost × (Profit % / 100)
 * Step 4: Selling Price (Before GST) = Vendor Cost + Profit Amount
 * Step 5: GST Amount = Selling Price Before GST × (GST % / 100)
 * Step 6: Final Price = Selling Price Before GST + GST Amount + Shipping
 */
export function calculatePrice(
  weightGrams,
  silverRate,
  makingChargePerGram,
  gstPercent,
  profitPercent,
  shippingCost,
  compareAtProfitPercent
) {
  const w = Number(weightGrams) || 0;
  const rate = Number(silverRate) || 0;
  const making = Number(makingChargePerGram) || 0;
  const gst = Number(gstPercent) || 0;
  const profitPct = Number(profitPercent) || 0;
  const shipping = Number(shippingCost) || 0;
  const compareAtProfitPct = compareAtProfitPercent !== undefined && compareAtProfitPercent !== null ? Number(compareAtProfitPercent) : profitPct;

  // Step 1 - Metal Value
  const metalValue = rate * w;
  
  // Step 2 - Vendor Cost
  const makingCharges = w * making;
  const vendorCost = metalValue + makingCharges;

  // Step 3 & 4 - Selling Price Before GST
  const profitAmount = vendorCost * (profitPct / 100);
  const sellingPriceBeforeGst = vendorCost + profitAmount;
  
  // Step 5 - GST
  const gstAmount = sellingPriceBeforeGst * (gst / 100);

  // Step 6 - Final Price
  const finalPrice = sellingPriceBeforeGst + gstAmount + shipping;

  // Calculate Compare-at Price using same logic
  const compareAtProfitAmount = vendorCost * (compareAtProfitPct / 100);
  const compareAtSellingPriceBeforeGst = vendorCost + compareAtProfitAmount;
  const compareAtGstAmount = compareAtSellingPriceBeforeGst * (gst / 100);
  const compareAtPrice = compareAtSellingPriceBeforeGst + compareAtGstAmount + shipping;

  const r2 = (n) => Number((Number(n) || 0).toFixed(2));

  return {
    baseMetalValue: r2(metalValue),
    makingCost: r2(makingCharges),
    vendorCost: r2(vendorCost),
    profitAmount: r2(profitAmount),
    sellingPriceBeforeGst: r2(sellingPriceBeforeGst),
    gstAmount: r2(gstAmount),
    shipping: r2(shipping),
    finalPrice: r2(finalPrice),
    compareAtPrice: r2(compareAtPrice),
    // Keep existing fields for backwards compatibility
    baseCost: r2(vendorCost),
    vendorPrice: r2(vendorCost),
    afterGst: r2(sellingPriceBeforeGst + gstAmount),
    inputs: {
      weightGrams: w,
      silverRate: rate,
      makingChargePerGram: making,
      gstPercent: gst,
      profitPercent: profitPct,
      shippingCost: shipping,
      compareAtProfitPercent: compareAtProfitPct,
    },
  };
}

/**
 * Merge a product's stored config with the app-wide defaults to produce the
 * effective attributes used for calculation. Per-product values win; null /
 * missing values fall back to settings defaults, then to hardcoded defaults.
 *
 * @param {object|null} config  Stored per-product config (from product-config.js)
 * @param {object} settings     App settings (from settings.js)
 */
export function resolveAttributes(config, settings = {}) {
  const defWeight = Number(settings?.default_weight_grams ?? 0) || 0;
  const defMaking = Number(settings?.default_making_charge_per_gram ?? 0) || 0;
  const defGst = Number(settings?.default_gst_percent ?? 3);
  const defProfit = Number(settings?.default_profit_percent ?? 24);
  const defCompareAtProfit = Number(settings?.default_compare_at_profit_percent ?? defProfit);
  const defShip = Number(settings?.default_shipping_cost ?? 100);

  const c = config || {};
  const pick = (v, d) => (v === undefined || v === null || v === "" ? d : Number(v));

  return {
    dynamic_pricing_enabled: !!c.dynamic_pricing_enabled,
    weight_grams: pick(c.weight_grams, defWeight),
    making_charge_per_gram: pick(c.making_charge_per_gram, defMaking),
    gst_percent: pick(c.gst_percent, defGst),
    profit_percent: pick(c.profit_percent, defProfit),
    compare_at_profit_percent: pick(c.compare_at_profit_percent, defCompareAtProfit),
    shipping_cost: pick(c.shipping_cost, defShip),
    // Additive: pass the stored per-product variant pricing config through
    // untouched. This has no default — it's either the merchant's saved
    // choice or null (= legacy single-price behavior).
    variant_pricing: c.variant_pricing || null,
  };
}

/**
 * ---------------------------------------------------------------------------
 * Variant pricing (additive extension — does not alter anything above).
 *
 * A product with 2+ variants can opt into one of two modes, stored in the
 * `zikmetal.variant_pricing` metafield (see product-config.js):
 *
 *   "weight"  — every variant gets its own weight (grams). Each variant's
 *               price is computed independently with the exact same formula
 *               used for simple products (calculatePrice above).
 *
 *   "manual"  — only the FIRST (base) variant is priced with the normal
 *               formula, using the product's existing weight_grams /
 *               making / gst / profit / shipping attributes. Every
 *               subsequent variant (in Shopify's variant order) is the
 *               previous variant's price plus a fixed increment.
 *
 * Products with no variant_pricing config, or with a single variant, are
 * completely untouched by this code path — callers only invoke it when
 * `variantPricing?.mode` is set AND there is more than one variant, so
 * existing simple-product behavior is 100% preserved.
 * ---------------------------------------------------------------------------
 */

/** Default increment (₹) used for Manual Variant Pricing when unset. */
export const DEFAULT_VARIANT_INCREMENT = 3000;

/**
 * Compute an independent price for every variant.
 *
 * @param {Array<{id:string, title?:string}>} variants  Variants in Shopify's
 *   display order (first = base variant for manual mode).
 * @param {object} attrs  Resolved base attributes from resolveAttributes()
 *   (making_charge_per_gram, gst_percent, profit_percent,
 *   compare_at_profit_percent, shipping_cost, weight_grams as fallback).
 * @param {number} silverRate  Live silver rate (per gram).
 * @param {{mode:"weight"|"manual"|null, increment?:number,
 *          variants?: Record<string,{weight_grams?: number}>}} variantPricing
 * @returns {Array<{variantId:string, title:string, weightGrams:number|null,
 *                   price:number, compareAtPrice:number, breakdown:object}>}
 */
export function calculateVariantPrices(variants, attrs, silverRate, variantPricing) {
  const list = Array.isArray(variants) ? variants : [];
  const mode = variantPricing?.mode;
  if (!mode || list.length < 2) return [];

  if (mode === "weight") {
    const weightMap = variantPricing?.variants || {};
    return list.map((v) => {
      const override = weightMap[v.id];
      const weightGrams =
        override && override.weight_grams !== undefined && override.weight_grams !== null && override.weight_grams !== ""
          ? Number(override.weight_grams)
          : attrs.weight_grams;
      const breakdown = calculatePrice(
        weightGrams,
        silverRate,
        attrs.making_charge_per_gram,
        attrs.gst_percent,
        attrs.profit_percent,
        attrs.shipping_cost,
        attrs.compare_at_profit_percent
      );
      return {
        variantId: v.id,
        title: v.title || "",
        weightGrams,
        price: breakdown.finalPrice,
        compareAtPrice: breakdown.compareAtPrice,
        breakdown,
      };
    });
  }

  if (mode === "manual") {
    const increment = Number(variantPricing?.increment);
    const step = Number.isFinite(increment) && increment >= 0 ? increment : DEFAULT_VARIANT_INCREMENT;

    // Base variant uses the product's normal (non-variant) attributes.
    const baseBreakdown = calculatePrice(
      attrs.weight_grams,
      silverRate,
      attrs.making_charge_per_gram,
      attrs.gst_percent,
      attrs.profit_percent,
      attrs.shipping_cost,
      attrs.compare_at_profit_percent
    );

    return list.map((v, index) => {
      const price = Number((baseBreakdown.finalPrice + step * index).toFixed(2));
      const compareAtPrice = Number((baseBreakdown.compareAtPrice + step * index).toFixed(2));
      return {
        variantId: v.id,
        title: v.title || "",
        weightGrams: index === 0 ? attrs.weight_grams : null,
        price,
        compareAtPrice,
        breakdown: index === 0 ? baseBreakdown : null,
      };
    });
  }

  return [];
}

/** Normalize a raw variant_pricing value (from metafield JSON or request body). */
export function normalizeVariantPricing(raw) {
  if (!raw || typeof raw !== "object") return null;
  const mode = raw.mode === "weight" || raw.mode === "manual" ? raw.mode : null;
  if (!mode) return null;

  const out = { mode };
  if (mode === "manual") {
    const inc = Number(raw.increment);
    out.increment = Number.isFinite(inc) && inc >= 0 ? inc : DEFAULT_VARIANT_INCREMENT;
  }
  if (mode === "weight") {
    const variants = {};
    const src = raw.variants && typeof raw.variants === "object" ? raw.variants : {};
    for (const [id, v] of Object.entries(src)) {
      const w = v?.weight_grams;
      if (w === undefined || w === null || w === "") continue;
      variants[id] = { weight_grams: Number(w) || 0 };
    }
    out.variants = variants;
  }
  return out;
}
