// Client mirror of the ZikMetal pricing formula (server is the source of truth).
//
// Step 1: Metal Value = Live Silver Price × Weight (grams)
// Step 2: Vendor Cost = Metal Value + Making Charges
// Step 3: Profit Amount = Vendor Cost × (Profit % / 100)
// Step 4: Selling Price Before GST = Vendor Cost + Profit Amount
// Step 5: GST Amount = Selling Price Before GST × (GST % / 100)
// Step 6: Final Price = Selling Price Before GST + GST Amount + Shipping
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
      gstPercent: gst,
      profitPercent: profitPct,
    },
  };
}
