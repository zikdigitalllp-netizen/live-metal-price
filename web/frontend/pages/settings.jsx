import { useState, useEffect } from "react";
import {
  Page,
  Layout,
  Card,
  FormLayout,
  TextField,
  Checkbox,
  Button,
  Stack,
  Text,
  Badge,
  Banner,
  SkeletonBodyText,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useQuery, useMutation, useQueryClient } from "react-query";
import { useAppBridge } from "@shopify/app-bridge-react";
import { api, formatMoney, formatRelativeTime } from "../lib/format";

const PROXY_BASE = "/apps/zikmetal-live-price/api";

export default function Settings() {
  const shopify = useAppBridge();
  const queryClient = useQueryClient();

  const [form, setForm] = useState(null);
  const [testResult, setTestResult] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api("/api/settings"),
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (data && !form) {
      setForm({
        metals_api_key: data.metals_api_key || "",
        custom_silver_price: data.custom_silver_price !== null && data.custom_silver_price !== undefined ? String(data.custom_silver_price) : "",
        use_custom_silver_price: data.use_custom_silver_price !== false,
        default_weight_grams: String(data.default_weight_grams ?? 0),
        default_making_charge_per_gram: String(data.default_making_charge_per_gram ?? 0),
        default_gst_percent: String(data.default_gst_percent ?? 3),
        default_profit_percent: String(data.default_profit_percent ?? 24),
        default_compare_at_profit_percent: String(data.default_compare_at_profit_percent ?? data.default_profit_percent ?? 24),
        default_shipping_cost: String(data.default_shipping_cost ?? 100),
        refresh_interval_seconds: String(data.refresh_interval_seconds ?? 30),
        show_strikethrough: data.show_strikethrough !== false,
        show_savings: data.show_savings !== false,
        auto_sync_on_refresh: data.auto_sync_on_refresh !== false,
      });
    }
  }, [data, form]);

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  const save = useMutation({
    mutationFn: () =>
      api("/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          metals_api_key: form.metals_api_key.trim(),
          custom_silver_price: form.custom_silver_price === "" ? null : Number(form.custom_silver_price),
          use_custom_silver_price: form.use_custom_silver_price,
          default_weight_grams: Number(form.default_weight_grams) || 0,
          default_making_charge_per_gram: Number(form.default_making_charge_per_gram) || 0,
          default_gst_percent: Number(form.default_gst_percent) || 0,
          default_profit_percent: Number(form.default_profit_percent) || 0,
          default_compare_at_profit_percent: Number(form.default_compare_at_profit_percent) || 0,
          default_shipping_cost: Number(form.default_shipping_cost) || 0,
          refresh_interval_seconds: Number(form.refresh_interval_seconds) || 30,
          show_strikethrough: form.show_strikethrough,
          show_savings: form.show_savings,
          auto_sync_on_refresh: form.auto_sync_on_refresh,
        }),
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(["settings"], saved);
      queryClient.invalidateQueries({ queryKey: ["mcx-rate"] });
      queryClient.invalidateQueries({ queryKey: ["products-pricing"] });
      shopify.toast.show("Settings saved");
    },
    onError: (e) => shopify.toast.show(e.message, { isError: true }),
  });

  const testApi = useMutation({
    mutationFn: () =>
      api("/api/test-api", {
        method: "POST",
        body: JSON.stringify({ api_key: form.metals_api_key.trim() }),
      }),
    onSuccess: (res) => setTestResult({ ok: true, data: res.rateData }),
    onError: (e) => setTestResult({ ok: false, message: e.message }),
  });

  const sync = useMutation({
    mutationFn: () => api("/api/sync-prices", { method: "POST" }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      shopify.toast.show(
        `Synced ${res.updated} product${res.updated === 1 ? "" : "s"} to Shopify` +
          (res.failed ? ` · ${res.failed} failed` : "")
      );
    },
    onError: (e) => shopify.toast.show(e.message, { isError: true }),
  });

  if (isLoading || !form) {
    return (
      <Page>
        <TitleBar title="ZikMetal · Settings" />
        <Layout>
          <Layout.Section>
            <Card sectioned>
              <SkeletonBodyText lines={10} />
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page>
      <TitleBar title="ZikMetal · Settings" />
      <Layout>
        <Layout.Section>
          <Card title="Metals.dev API" sectioned>
            <FormLayout>
              <TextField
                label="API key"
                value={form.metals_api_key}
                onChange={set("metals_api_key")}
                autoComplete="off"
                type="password"
                helpText="Live MCX rate via api.metals.dev (authority=mcx, INR/g). The AM rate is used 9AM–9PM IST and the PM rate 9PM–9AM IST. Leave blank to run in sample mode."
              />
              <Stack alignment="center">
                <Button
                  onClick={() => {
                    setTestResult(null);
                    testApi.mutate();
                  }}
                  loading={testApi.isLoading}
                >
                  Test API connection
                </Button>
                {testResult?.ok ? (
                  <Badge status="success">
                    {testResult.data?.slot ? `${testResult.data.slot.toUpperCase()} · ` : ""}
                    {formatMoney(testResult.data?.rate, testResult.data?.currency || "INR", "en-IN")}/
                    {testResult.data?.unit || "g"}
                  </Badge>
                ) : null}
              </Stack>
              {testResult && !testResult.ok ? (
                <Banner status="critical">{testResult.message}</Banner>
              ) : null}
              {testResult?.ok && testResult.data?.mock ? (
                <Banner status="warning">
                  Connected in sample mode — no valid key, so a mock rate is returned.
                </Banner>
              ) : null}
            </FormLayout>
          </Card>

          <Card title="Custom Silver Price" sectioned>
            <Text tone="subdued" as="p" variant="bodySm">
              Use a custom silver price instead of fetching from the API.
            </Text>
            <div style={{ marginTop: "1rem" }}>
              <FormLayout>
                <Checkbox
                  label="Use custom silver price"
                  checked={form.use_custom_silver_price}
                  onChange={set("use_custom_silver_price")}
                  helpText="Enable to use your custom price instead of the live API rate."
                />
                {form.use_custom_silver_price && (
                  <TextField
                    label="Silver price per gram (₹)"
                    type="number"
                    value={form.custom_silver_price}
                    onChange={set("custom_silver_price")}
                    autoComplete="off"
                    min={0}
                    step={0.01}
                    helpText="Enter your custom silver price in INR per gram."
                  />
                )}
              </FormLayout>
            </div>
          </Card>

          <Card title="Default pricing values" sectioned>
            <Text tone="subdued" as="p" variant="bodySm">
              Used for any product that doesn’t override the value in its own
              configuration. Stored in the app — not in Shopify metafields.
            </Text>
            <div style={{ marginTop: "1rem" }}>
              <FormLayout>
                <FormLayout.Group>
                  <TextField
                    label="Default weight (g)"
                    type="number"
                    value={form.default_weight_grams}
                    onChange={set("default_weight_grams")}
                    autoComplete="off"
                    min={0}
                  />
                  <TextField
                    label="Default making charge / g (₹)"
                    type="number"
                    value={form.default_making_charge_per_gram}
                    onChange={set("default_making_charge_per_gram")}
                    autoComplete="off"
                    min={0}
                  />
                </FormLayout.Group>
                <FormLayout.Group>
                  <TextField
                    label="Default GST %"
                    type="number"
                    value={form.default_gst_percent}
                    onChange={set("default_gst_percent")}
                    autoComplete="off"
                    min={0}
                  />
                  <TextField
                    label="Default profit %"
                    type="number"
                    value={form.default_profit_percent}
                    onChange={set("default_profit_percent")}
                    autoComplete="off"
                    min={0}
                  />
                  <TextField
                    label="Default compare at profit %"
                    type="number"
                    value={form.default_compare_at_profit_percent}
                    onChange={set("default_compare_at_profit_percent")}
                    autoComplete="off"
                    min={0}
                  />
                  <TextField
                    label="Default shipping (₹)"
                    type="number"
                    value={form.default_shipping_cost}
                    onChange={set("default_shipping_cost")}
                    autoComplete="off"
                    min={0}
                  />
                </FormLayout.Group>
                <TextField
                  label="Storefront refresh interval (seconds)"
                  type="number"
                  value={form.refresh_interval_seconds}
                  onChange={set("refresh_interval_seconds")}
                  autoComplete="off"
                  min={5}
                  helpText="How often the storefront re-checks the live rate and re-renders prices."
                />
              </FormLayout>
            </div>
          </Card>

          <Card title="Storefront display" sectioned>
            <FormLayout>
              <Checkbox
                label="Show strike-through compare-at price"
                checked={form.show_strikethrough}
                onChange={set("show_strikethrough")}
              />
              <Checkbox
                label="Show savings / markup badge"
                checked={form.show_savings}
                onChange={set("show_savings")}
              />
            </FormLayout>
          </Card>

          <div style={{ marginTop: "1rem" }}>
            <Button primary onClick={() => save.mutate()} loading={save.isLoading}>
              Save settings
            </Button>
          </div>
        </Layout.Section>

        <Layout.Section secondary>
          <Card title="Checkout price sync" sectioned>
            <Stack vertical spacing="tight">
              <Text as="p" variant="bodySm" tone="subdued">
                Pushes the computed final price onto each enabled product’s Shopify
                variants, so the cart and checkout charge the calculated amount.
              </Text>
              <Checkbox
                label="Auto-sync whenever the rate is refreshed"
                checked={form.auto_sync_on_refresh}
                onChange={set("auto_sync_on_refresh")}
              />
              <Stack distribution="equalSpacing">
                <Text as="span" tone="subdued">
                  Last price sync
                </Text>
                <Text as="span">{formatRelativeTime(data?.last_price_sync_time)}</Text>
              </Stack>
              <Button onClick={() => sync.mutate()} loading={sync.isLoading}>
                Sync prices to Shopify now
              </Button>
            </Stack>
          </Card>

          <Card title="Status" sectioned>
            <Stack vertical spacing="tight">
              <Stack distribution="equalSpacing">
                <Text as="span" tone="subdued">
                  Mode
                </Text>
                {form.metals_api_key ? (
                  <Badge status="success">Live API</Badge>
                ) : (
                  <Badge status="warning">Sample / mock</Badge>
                )}
              </Stack>
              <Stack distribution="equalSpacing">
                <Text as="span" tone="subdued">
                  Last rate sync
                </Text>
                <Text as="span">{formatRelativeTime(data?.last_sync_time)}</Text>
              </Stack>
            </Stack>
          </Card>

          <Card title="Storefront proxy" sectioned>
            <Stack vertical spacing="tight">
              <Text as="p" variant="bodySm" tone="subdued">
                The storefront fetches live prices through this App Proxy path:
              </Text>
              <div
                style={{
                  fontFamily: "monospace",
                  fontSize: "12px",
                  background: "var(--p-color-bg-surface-secondary)",
                  padding: "8px",
                  borderRadius: "8px",
                  wordBreak: "break-all",
                }}
              >
                {PROXY_BASE}/mcx-rate
                <br />
                {PROXY_BASE}/products/prices?ids=
              </div>
              <Text as="p" variant="bodySm" tone="subdued">
                Enable the “ZikMetal Live Pricing” app embed in your theme editor to
                activate the storefront script.
              </Text>
            </Stack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
