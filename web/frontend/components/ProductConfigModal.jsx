import { useEffect, useState } from "react";
import {
  Modal,
  Stack,
  TextField,
  Checkbox,
  Text,
  Banner,
  Box,
} from "@shopify/polaris";
import { useMutation, useQueryClient } from "react-query";
import { useAppBridge } from "@shopify/app-bridge-react";
import { api } from "../lib/format";
import { calculatePrice } from "../lib/pricing";
import { PriceBreakdown } from "./PriceBreakdown";

const numField = (v) => (v === "" || v === null || v === undefined ? "" : String(v));

export function ProductConfigModal({ open, product, silverRate, defaults, onClose }) {
  const shopify = useAppBridge();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    dynamic_pricing_enabled: false,
    weight_grams: "",
    making_charge_per_gram: "",
    gst_percent: "",
    profit_percent: "",
    compare_at_profit_percent: "",
    shipping_cost: "",
  });

  useEffect(() => {
    if (!product) return;
    setForm({
      dynamic_pricing_enabled: !!product.dynamicPricingEnabled,
      weight_grams: numField(product.weightGrams),
      making_charge_per_gram: numField(product.makingChargePerGram),
      gst_percent: numField(product.gstPercent ?? defaults?.default_gst_percent),
      profit_percent: numField(product.profitPercent ?? defaults?.default_profit_percent),
      compare_at_profit_percent: numField(product.compareAtProfitPercent ?? defaults?.default_compare_at_profit_percent),
      shipping_cost: numField(product.shippingCost ?? defaults?.default_shipping_cost),
    });
  }, [product, defaults]);

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  const breakdown = calculatePrice({
    weightGrams: form.weight_grams,
    silverRate,
    makingChargePerGram: form.making_charge_per_gram,
    gstPercent: form.gst_percent,
    profitPercent: form.profit_percent,
    compareAtProfitPercent: form.compare_at_profit_percent,
    shippingCost: form.shipping_cost,
  });

  const save = useMutation({
    mutationFn: () =>
      api(`/api/product/${product.id}/config`, {
        method: "PUT",
        body: JSON.stringify({
          dynamic_pricing_enabled: form.dynamic_pricing_enabled,
          weight_grams: Number(form.weight_grams) || 0,
          making_charge_per_gram: Number(form.making_charge_per_gram) || 0,
          gst_percent: Number(form.gst_percent) || 0,
          profit_percent: Number(form.profit_percent) || 0,
          compare_at_profit_percent: Number(form.compare_at_profit_percent) || null,
          shipping_cost: Number(form.shipping_cost) || 0,
        }),
      }),
    onSuccess: async () => {
      shopify.toast.show("Product pricing saved, syncing to Shopify...");
      queryClient.invalidateQueries({ queryKey: ["products-pricing"] });
      // Auto-sync after save
      await api("/api/sync-prices", { method: "POST" });
      shopify.toast.show("Product synced to Shopify!");
      onClose();
    },
    onError: (e) => shopify.toast.show(e.message, { isError: true }),
  });

  if (!product) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={product.title}
      primaryAction={{
        content: "Save",
        onAction: () => save.mutate(),
        loading: save.isLoading,
      }}
      secondaryActions={[{ content: "Cancel", onAction: onClose }]}
    >
      <Modal.Section>
        <Stack vertical spacing="loose">
          <Checkbox
            label="Enable dynamic pricing for this product"
            checked={form.dynamic_pricing_enabled}
            onChange={set("dynamic_pricing_enabled")}
            helpText="When on, the storefront shows the live calculated price instead of the Shopify base price."
          />

          <Stack distribution="fillEvenly">
            <TextField
              label="Weight (grams)"
              type="number"
              value={form.weight_grams}
              onChange={set("weight_grams")}
              autoComplete="off"
              min={0}
              step={0.001}
            />
            <TextField
              label="Making charge / gram (₹)"
              type="number"
              value={form.making_charge_per_gram}
              onChange={set("making_charge_per_gram")}
              autoComplete="off"
              min={0}
            />
          </Stack>

          <Stack distribution="fillEvenly">
            <TextField
              label="GST %"
              type="number"
              value={form.gst_percent}
              onChange={set("gst_percent")}
              autoComplete="off"
              min={0}
            />
            <TextField
              label="Profit %"
              type="number"
              value={form.profit_percent}
              onChange={set("profit_percent")}
              autoComplete="off"
              min={0}
            />
            <TextField
              label="Compare at Profit %"
              type="number"
              value={form.compare_at_profit_percent}
              onChange={set("compare_at_profit_percent")}
              autoComplete="off"
              min={0}
            />
            <TextField
              label="Shipping (₹)"
              type="number"
              value={form.shipping_cost}
              onChange={set("shipping_cost")}
              autoComplete="off"
              min={0}
            />
          </Stack>

          {!form.dynamic_pricing_enabled ? (
            <Banner status="info">
              Dynamic pricing is off — the storefront will keep showing the Shopify
              base price for this product.
            </Banner>
          ) : null}

          <Box
            background="bg-surface-secondary"
            padding="400"
            borderRadius="200"
          >
            <Stack vertical spacing="tight">
              <Text variant="headingSm" as="h3">
                Live preview
              </Text>
              <Text tone="subdued" variant="bodySm" as="p">
                Based on the current silver rate of ₹{Number(silverRate || 0).toFixed(2)}/g.
              </Text>
              <PriceBreakdown breakdown={breakdown} currency={product.currencyCode} />
            </Stack>
          </Box>
        </Stack>
      </Modal.Section>
    </Modal>
  );
}
