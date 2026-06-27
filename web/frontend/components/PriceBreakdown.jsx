import { Stack, Text, Divider } from "@shopify/polaris";
import { formatMoney } from "../lib/format";

function Row({ label, value, strong, prefix }) {
  return (
    <Stack distribution="equalSpacing" alignment="center">
      <Text tone={strong ? undefined : "subdued"} as="span" variant={strong ? "headingSm" : "bodyMd"}>
        {prefix && <span style={{ marginRight: "0.5rem" }}>{prefix}</span>}
        {label}
      </Text>
      <Text as="span" variant={strong ? "headingSm" : "bodyMd"} fontWeight={strong ? "bold" : undefined}>
        {value}
      </Text>
    </Stack>
  );
}

export function PriceBreakdown({ breakdown, currency = "INR" }) {
  if (!breakdown) return null;
  const m = (n) => formatMoney(n, currency, "en-IN");
  return (
    <Stack vertical spacing="extraTight">
      <Row label="Metal Value" value={m(breakdown.baseMetalValue)} />
      <Row label="Making Charges" value={m(breakdown.makingCost)} prefix="+" />
      <Divider />
      <Row label="Vendor Cost" value={m(breakdown.vendorCost)} />
      <Row 
        label={`Profit (${breakdown.inputs?.profitPercent || 0}%)`} 
        value={m(breakdown.profitAmount)} 
        prefix="+" 
      />
      <Divider />
      <Row label="Selling Price (Before GST)" value={m(breakdown.sellingPriceBeforeGst)} />
      <Row 
        label={`GST (${breakdown.inputs?.gstPercent || 0}%)`} 
        value={m(breakdown.gstAmount)} 
        prefix="+" 
      />
      <Row label="Shipping" value={m(breakdown.shipping)} prefix="+" />
      <Divider />
      <Row label="Final Price" value={m(breakdown.finalPrice)} strong />
      {breakdown.compareAtPrice && (
        <Row label="Compare at Price" value={m(breakdown.compareAtPrice)} />
      )}
    </Stack>
  );
}
