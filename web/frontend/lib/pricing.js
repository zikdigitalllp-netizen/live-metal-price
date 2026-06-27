// Client mirror of the ZikMetal pricing formula (server is the source of truth).
//
//   Base Metal Value = Silver Rate × Weight
//   Making Cost      = Weight × Making Charge / gram
//   Base Cost        = Base Metal Value + Making Cost   (= Vendor Price)
//   GST Amount       = Vendor Price × GST%
//   After GST        = Vendor Price + GST Amount
//   Final Price      = (After GST + Shipping) × (1 + Profit Margin%)
export function calculatePrice({
  weightGrams = 0,
  silverRate = 0,
  makingChargePerGram = 0,
  gstPercent = 0,
  profitPercent = 0,
  compareAtProfitPercent,
  shippingCost = 0,
}) {
  const w = Number(weightGrams) || 0;
  const rate = Number(silverRate) || 0;
  const making = Number(makingChargePerGram) || 0;
  const gst = Number(gstPercent) || 0;
  const profitPct = Number(profitPercent) || 0;
  const compareAtProfitPct = compareAtProfitPercent !== undefined && compareAtProfitPercent !== null ? Number(compareAtProfitPercent) : profitPct;
  const shipping = Number(shippingCost) || 0;

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
  };
}
