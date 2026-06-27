// @ts-check

/**
 * ZikMetal pricing formula (updated per spec). This is the single source of
 * truth used by the backend, the App-Proxy storefront endpoints and (mirrored)
 * the client engine.
 *
 *   Base Metal Value = Silver Rate × Weight (g)
 *   Making Cost      = Weight (g) × Making Charge per Gram
 *   Base Cost        = Base Metal Value + Making Cost
 *   Vendor Price     = Base Cost
 *   GST Amount       = Vendor Price × GST%
 *   After GST        = Vendor Price + GST Amount
 *   Final Price      = (After GST + Shipping) × (1 + Profit Margin%)
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

  const baseMetalValue = rate * w;
  const makingCost = w * making;
  const baseCost = baseMetalValue + makingCost;
  const vendorPrice = baseCost;
  const gstAmount = vendorPrice * (gst / 100);
  const afterGst = vendorPrice + gstAmount;
  const profitBase = afterGst + shipping;
  const profitAmount = profitBase * (profitPct / 100);
  const finalPrice = profitBase * (1 + profitPct / 100);
  const compareAtPrice = profitBase * (1 + compareAtProfitPct / 100);

  const r2 = (n) => Number((Number(n) || 0).toFixed(2));

  return {
    baseMetalValue: r2(baseMetalValue),
    makingCost: r2(makingCost),
    baseCost: r2(baseCost),
    vendorPrice: r2(vendorPrice),
    gstAmount: r2(gstAmount),
    afterGst: r2(afterGst),
    shipping: r2(shipping),
    profitAmount: r2(profitAmount),
    finalPrice: r2(finalPrice),
    compareAtPrice: r2(compareAtPrice),
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
