import { useMemo } from "react";
import {
  Page,
  Layout,
  Card,
  Stack,
  Text,
  Button,
  Badge,
  SkeletonBodyText,
  EmptyState,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "react-query";
import { SilverRateCard } from "../components";
import { api, formatMoney } from "../lib/format";

function StatCard({ label, value, sublabel }) {
  return (
    <Card sectioned>
      <Stack vertical spacing="extraTight">
        <Text variant="bodySm" tone="subdued" as="p">
          {label}
        </Text>
        <Text variant="heading2xl" as="p">
          {value}
        </Text>
        {sublabel ? (
          <Text variant="bodySm" tone="subdued" as="p">
            {sublabel}
          </Text>
        ) : null}
      </Stack>
    </Card>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ["products-pricing"],
    queryFn: () => api("/api/products/dynamic-pricing"),
    refetchOnWindowFocus: false,
  });

  const products = data?.products || [];
  const currency = products[0]?.currencyCode || "INR";

  const stats = useMemo(() => {
    const enabled = products.filter((p) => p.dynamicPricingEnabled);
    const avg =
      enabled.length > 0
        ? enabled.reduce((sum, p) => sum + (Number(p.calculatedPrice) || 0), 0) /
          enabled.length
        : 0;
    return {
      total: products.length,
      enabledCount: enabled.length,
      avgPrice: avg,
      recent: enabled.slice(0, 5),
    };
  }, [products]);

  return (
    <Page>
      <TitleBar title="ZikMetal · Dashboard" />
      <Layout>
        <Layout.Section>
          <SilverRateCard />
        </Layout.Section>

        <Layout.Section secondary>
          <Card sectioned>
            <Stack vertical spacing="tight">
              <Text variant="headingSm" as="h2">
                Get started
              </Text>
              <Text tone="subdued" as="p">
                Configure live MCX-based pricing for your silver jewellery in three
                steps.
              </Text>
              <Stack vertical spacing="extraTight">
                <Text as="p">1. Add your Metals.dev API key in Settings.</Text>
                <Text as="p">2. Enable dynamic pricing per product in Products.</Text>
                <Text as="p">
                  3. Turn on the ZikMetal app embed in your theme editor.
                </Text>
              </Stack>
              <Stack>
                <Button primary onClick={() => navigate("/products")}>
                  Manage products
                </Button>
                <Button onClick={() => navigate("/settings")}>Settings</Button>
              </Stack>
            </Stack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Stack distribution="fillEvenly">
            <StatCard
              label="Total products"
              value={isLoading ? "—" : stats.total}
            />
            <StatCard
              label="Dynamic pricing on"
              value={isLoading ? "—" : stats.enabledCount}
              sublabel={
                stats.total > 0
                  ? `${Math.round((stats.enabledCount / stats.total) * 100)}% of catalog`
                  : undefined
              }
            />
            <StatCard
              label="Avg. live price"
              value={
                isLoading ? "—" : formatMoney(stats.avgPrice, currency, "en-IN")
              }
              sublabel="across enabled products"
            />
          </Stack>
        </Layout.Section>

        <Layout.Section>
          <Card
            title="Recently enabled"
            actions={[{ content: "View all", onAction: () => navigate("/products") }]}
          >
            <Card.Section>
              {isLoading ? (
                <SkeletonBodyText lines={4} />
              ) : stats.recent.length === 0 ? (
                <EmptyState
                  heading="No products on dynamic pricing yet"
                  action={{
                    content: "Configure products",
                    onAction: () => navigate("/products"),
                  }}
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>
                    Enable dynamic pricing on a product to start showing live
                    MCX-based prices on your storefront.
                  </p>
                </EmptyState>
              ) : (
                <Stack vertical spacing="loose">
                  {stats.recent.map((p) => (
                    <Stack
                      key={p.id}
                      alignment="center"
                      distribution="equalSpacing"
                    >
                      <Stack alignment="center" spacing="tight">
                        <Text as="span" variant="bodyMd" fontWeight="semibold">
                          {p.title}
                        </Text>
                        <Badge status="success">On</Badge>
                      </Stack>
                      <Text as="span" variant="bodyMd">
                        {formatMoney(p.calculatedPrice, p.currencyCode, "en-IN")}
                      </Text>
                    </Stack>
                  ))}
                </Stack>
              )}
            </Card.Section>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
