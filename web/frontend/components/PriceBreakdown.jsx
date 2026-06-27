import { Stack, Text, Divider } from "@shopify/polaris";
import { formatMoney } from "../lib/format";

function Row({ label, value, strong }) {
  return (
    <Stack distribution="equalSpacing" alignment="center">
      <Text tone={strong ? undefined : "subdued"} as="span" variant={strong ? "headingSm" : "bodyMd"}>
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
      <Row label="Base metal value (rate × weight)" value={m(breakdown.baseMetalValue)} />
      <Row label="Making cost (weight × making)" value={m(breakdown.makingCost)} />
      <Row label="Base / vendor price" value={m(breakdown.baseCost)} />
      <Row label="GST amount" value={m(breakdown.gstAmount)} />
      <Row label="After GST" value={m(breakdown.afterGst)} />
      <Row label="Shipping" value={m(breakdown.shipping)} />
      <Row label="Profit margin" value={m(breakdown.profitAmount)} />
      <Divider />
      <Row label="Final price" value={m(breakdown.finalPrice)} strong />
      {breakdown.compareAtPrice && (
        <Row label="Compare at price" value={m(breakdown.compareAtPrice)} />
      )}
    </Stack>
  );
}
