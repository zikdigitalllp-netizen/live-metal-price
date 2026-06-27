import { useState, useCallback } from "react";
import {
  Page,
  Card,
  IndexTable,
  Thumbnail,
  Text,
  Badge,
  Button,
  Stack,
  Banner,
  SkeletonBodyText,
  EmptyState,
  Tooltip,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { useQuery, useMutation, useQueryClient } from "react-query";
import { ProductConfigModal } from "../components";
import { api, formatMoney } from "../lib/format";

const PLACEHOLDER =
  "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-image.png";

export default function Products() {
  const shopify = useAppBridge();
  const queryClient = useQueryClient();
  const [activeProduct, setActiveProduct] = useState(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["products-pricing"],
    queryFn: () => api("/api/products/dynamic-pricing"),
    refetchOnWindowFocus: false,
  });
  
  const { data: settingsData } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api("/api/settings"),
    refetchOnWindowFocus: false,
  });

  const sync = useMutation({
    mutationFn: () => api("/api/sync-prices", { method: "POST" }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["products-pricing"] });
      shopify.toast.show(
        `Synced ${res.updated} product${res.updated === 1 ? "" : "s"} to Shopify` +
          (res.failed ? ` · ${res.failed} failed` : "")
      );
    },
    onError: (e) => shopify.toast.show(e.message, { isError: true }),
  });

  const products = data?.products || [];
  const silverRate = data?.silverRate?.rate || 0;
  const enabledCount = products.filter((p) => p.dynamicPricingEnabled).length;

  const openConfig = useCallback((product) => setActiveProduct(product), []);
  const closeConfig = useCallback(() => setActiveProduct(null), []);

  const rowMarkup = products.map((p, index) => (
    <IndexTable.Row id={String(p.id)} key={p.id} position={index}>
      <IndexTable.Cell>
        <Stack alignment="center" spacing="tight" wrap={false}>
          <Thumbnail
            source={p.image || PLACEHOLDER}
            alt={p.title}
            size="small"
          />
          <Text as="span" variant="bodyMd" fontWeight="semibold">
            {p.title}
          </Text>
        </Stack>
      </IndexTable.Cell>
      <IndexTable.Cell>
        {p.dynamicPricingEnabled ? (
          <Badge status="success">Dynamic</Badge>
        ) : (
          <Badge>Base price</Badge>
        )}
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" alignment="end" numeric>
          {Number(p.weightGrams) ? `${Number(p.weightGrams)} g` : "—"}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" alignment="end" numeric tone="subdued">
          {formatMoney(p.basePrice, p.currencyCode, "en-IN")}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" alignment="end" numeric tone="subdued">
          {p.dynamicPricingEnabled && p.compareAtPrice ? (
            formatMoney(p.compareAtPrice, p.currencyCode, "en-IN")
          ) : (
            "—"
          )}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" alignment="end" numeric fontWeight="semibold">
          {p.dynamicPricingEnabled ? (
            formatMoney(p.calculatedPrice, p.currencyCode, "en-IN")
          ) : (
            <Tooltip content="Enable dynamic pricing to compute a live price">
              <Text as="span" tone="subdued">
                —
              </Text>
            </Tooltip>
          )}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Button size="slim" onClick={() => openConfig(p)}>
          Configure
        </Button>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page fullWidth>
      <TitleBar title="ZikMetal · Products">
        <button
          variant="primary"
          onClick={() => sync.mutate()}
          disabled={sync.isLoading || enabledCount === 0}
        >
          {sync.isLoading ? "Syncing…" : "Sync prices to Shopify"}
        </button>
      </TitleBar>

      {data?.silverRate?.custom ? (
        <div style={{ marginBottom: "1rem" }}>
          <Banner status="info">
            Using custom silver price: {formatMoney(data.silverRate.rate, data.silverRate.currency || "INR", "en-IN")}/g
          </Banner>
        </div>
      ) : null}
      
      {data?.silverRate?.mock ? (
        <div style={{ marginBottom: "1rem" }}>
          <Banner status="warning">
            Showing a sample silver rate. Add your Metals.dev API key in Settings to
            calculate prices from the live MCX rate.
          </Banner>
        </div>
      ) : null}

      <Card>
        {isLoading ? (
          <Card.Section>
            <SkeletonBodyText lines={8} />
          </Card.Section>
        ) : isError ? (
          <Card.Section>
            <Banner status="critical" title="Could not load products">
              {error?.message || "Unknown error"}
            </Banner>
          </Card.Section>
        ) : products.length === 0 ? (
          <Card.Section>
            <EmptyState
              heading="No products found"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>
                Add products to your store, then return here to enable live
                MCX-based pricing.
              </p>
            </EmptyState>
          </Card.Section>
        ) : (
          <IndexTable
            itemCount={products.length}
            selectable={false}
            headings={[
              { title: "Product" },
              { title: "Pricing" },
              { title: "Weight", alignment: "end" },
              { title: "Base price", alignment: "end" },
              { title: "Compare at", alignment: "end" },
              { title: "Live price", alignment: "end" },
              { title: "" },
            ]}
          >
            {rowMarkup}
          </IndexTable>
        )}
      </Card>

      <ProductConfigModal
        open={!!activeProduct}
        product={activeProduct}
        silverRate={silverRate}
        defaults={settingsData}
        onClose={closeConfig}
      />
    </Page>
  );
}
