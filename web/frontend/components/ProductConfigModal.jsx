import { useEffect, useState } from "react";
import {
  Modal,
  Stack,
  TextField,
  Checkbox,
  Text,
  Banner,
  Box,
  RadioButton,
  DataTable,
} from "@shopify/polaris";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { useAppBridge } from "@shopify/app-bridge-react";
import { api, formatMoney } from "../lib/format";
import { calculatePrice, calculateVariantPrices, DEFAULT_VARIANT_INCREMENT } from "../lib/pricing";
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

  // ---------------------------------------------------------------------
  // Variant pricing (additive — only relevant for products with 2+ variants)
  // ---------------------------------------------------------------------
  const hasVariants = (product?.variantIds?.length || 0) > 1;

  const { data: variantsView } = useQuery({
    queryKey: ["product-variants", product?.id],
    queryFn: () => api(`/api/product/${product.id}/variants`),
    enabled: open && !!product && hasVariants,
    refetchOnWindowFocus: false,
  });

  // "none" = single price for all variants (existing/default behavior)
  const [variantMode, setVariantMode] = useState("none");
  const [increment, setIncrement] = useState(String(DEFAULT_VARIANT_INCREMENT));
  const [variantWeights, setVariantWeights] = useState({}); // variantId -> weight string

  useEffect(() => {
    if (!open || !hasVariants) return;
    const vp = variantsView?.variantPricing;
    setVariantMode(vp?.mode || "none");
    setIncrement(String(vp?.increment ?? DEFAULT_VARIANT_INCREMENT));
    const weights = {};
    for (const v of variantsView?.variants || []) {
      const w = vp?.variants?.[v.id]?.weight_grams;
      weights[v.id] = w !== undefined && w !== null ? String(w) : "";
    }
    setVariantWeights(weights);
  }, [open, hasVariants, variantsView]);

  const setVariantWeight = (id) => (value) =>
    setVariantWeights((w) => ({ ...w, [id]: value }));

  const variantList = variantsView?.variants || [];
  const variantPreview =
    variantMode === "none"
      ? []
      : calculateVariantPrices(
          variantList.map((v) => ({ id: v.id, title: v.title })),
          {
            weightGrams: form.weight_grams,
            makingChargePerGram: form.making_charge_per_gram,
            gstPercent: form.gst_percent,
            profitPercent: form.profit_percent,
            compareAtProfitPercent: form.compare_at_profit_percent,
            shippingCost: form.shipping_cost,
          },
          silverRate,
          variantMode === "weight"
            ? {
                mode: "weight",
                variants: Object.fromEntries(
                  Object.entries(variantWeights)
                    .filter(([, w]) => w !== "")
                    .map(([id, w]) => [id, { weight_grams: Number(w) }])
                ),
              }
            : { mode: "manual", increment: Number(increment) || DEFAULT_VARIANT_INCREMENT }
        );

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
    mutationFn: async () => {
      const result = await api(`/api/product/${product.id}/config`, {
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
      });

      // Additive: only touched for multi-variant products. "none" clears any
      // previously-saved variant pricing, restoring the single-price behavior.
      if (hasVariants) {
        let variant_pricing = null;
        if (variantMode === "weight") {
          variant_pricing = {
            mode: "weight",
            variants: Object.fromEntries(
              Object.entries(variantWeights)
                .filter(([, w]) => w !== "")
                .map(([id, w]) => [id, { weight_grams: Number(w) }])
            ),
          };
        } else if (variantMode === "manual") {
          variant_pricing = { mode: "manual", increment: Number(increment) || DEFAULT_VARIANT_INCREMENT };
        }
        await api(`/api/product/${product.id}/variant-config`, {
          method: "PUT",
          body: JSON.stringify({ variant_pricing }),
        });
      }

      return result;
    },
    onSuccess: async () => {
      shopify.toast.show("Product pricing saved, syncing to Shopify...");
      queryClient.invalidateQueries({ queryKey: ["products-pricing"] });
      queryClient.invalidateQueries({ queryKey: ["product-variants", product.id] });
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

          {hasVariants && form.dynamic_pricing_enabled ? (
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <Stack vertical spacing="tight">
                <Text variant="headingSm" as="h3">
                  Variant pricing ({product.variantIds.length} variants)
                </Text>
                <Text tone="subdued" variant="bodySm" as="p">
                  Choose how each variant's price is calculated. Leave this as
                  "Single price" to keep pricing all variants the same, exactly
                  as before.
                </Text>

                <RadioButton
                  label="Single price for all variants (default)"
                  checked={variantMode === "none"}
                  id="variant-mode-none"
                  name="variantMode"
                  onChange={() => setVariantMode("none")}
                />
                <RadioButton
                  label="Weight-based variant pricing — set an individual weight per variant"
                  checked={variantMode === "weight"}
                  id="variant-mode-weight"
                  name="variantMode"
                  onChange={() => setVariantMode("weight")}
                />
                <RadioButton
                  label="Manual variant pricing — base variant price + fixed increment per variant"
                  checked={variantMode === "manual"}
                  id="variant-mode-manual"
                  name="variantMode"
                  onChange={() => setVariantMode("manual")}
                />

                {variantMode === "weight" ? (
                  <Stack vertical spacing="tight">
                    {variantList.map((v) => (
                      <TextField
                        key={v.id}
                        label={v.title}
                        type="number"
                        min={0}
                        step={0.001}
                        value={variantWeights[v.id] ?? ""}
                        onChange={setVariantWeight(v.id)}
                        autoComplete="off"
                        helpText={
                          variantWeights[v.id] === "" || variantWeights[v.id] === undefined
                            ? `Blank uses the product weight above (${form.weight_grams || 0}g)`
                            : undefined
                        }
                      />
                    ))}
                  </Stack>
                ) : null}

                {variantMode === "manual" ? (
                  <TextField
                    label="Price increment per variant (₹)"
                    type="number"
                    min={0}
                    value={increment}
                    onChange={setIncrement}
                    autoComplete="off"
                    helpText={`The base (first) variant uses the formula above. Each following variant adds ₹${increment || DEFAULT_VARIANT_INCREMENT} to the previous variant's price.`}
                  />
                ) : null}

                {variantMode !== "none" && variantPreview.length > 0 ? (
                  <DataTable
                    columnContentTypes={["text", "text", "numeric", "numeric"]}
                    headings={["Variant", "Weight", "Price", "Compare at"]}
                    rows={variantPreview.map((p) => [
                      p.title,
                      p.weightGrams !== null && p.weightGrams !== undefined ? `${p.weightGrams} g` : "—",
                      formatMoney(p.price, product.currencyCode, "en-IN"),
                      p.compareAtPrice > p.price
                        ? formatMoney(p.compareAtPrice, product.currencyCode, "en-IN")
                        : "—",
                    ])}
                  />
                ) : null}
              </Stack>
            </Box>
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
