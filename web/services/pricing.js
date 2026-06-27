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
  };
}
