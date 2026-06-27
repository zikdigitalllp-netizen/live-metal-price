import { Card, Stack, Text, Button, Badge, Banner, SkeletonDisplayText } from "@shopify/polaris";
import { useQuery, useMutation, useQueryClient } from "react-query";
import { useAppBridge } from "@shopify/app-bridge-react";
import { api, formatMoney, formatRelativeTime } from "../lib/format";

export function SilverRateCard() {
  const shopify = useAppBridge();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["mcx-rate"],
    queryFn: () => api("/api/mcx-rate"),
    refetchInterval: 30000,
    refetchOnWindowFocus: false,
  });

  const refresh = useMutation({
    mutationFn: () => api("/api/mcx-rate/refresh", { method: "POST" }),
    onSuccess: (fresh) => {
      queryClient.setQueryData(["mcx-rate"], fresh);
      queryClient.invalidateQueries({ queryKey: ["products-pricing"] });
      const synced = fresh?.sync?.updated;
      shopify.toast.show(
        synced != null
          ? `Rate refreshed · ${synced} product${synced === 1 ? "" : "s"} synced`
          : "Silver rate refreshed"
      );
    },
    onError: (e) => shopify.toast.show(e.message, { isError: true }),
  });

  const slotLabel = data?.slot === "am" ? "AM (9AM–9PM IST)" : "PM (9PM–9AM IST)";

  return (
    <Card sectioned>
      <Stack vertical spacing="tight">
        <Stack alignment="center" distribution="equalSpacing">
          <Text variant="headingSm" as="h2">
            {data?.custom ? "Custom Silver Price" : "Live MCX Silver Rate"}
          </Text>
          <Stack spacing="extraTight">
            {data?.slot && !data?.custom ? <Badge>{data.slot.toUpperCase()}</Badge> : null}
            {data?.custom ? (
              <Badge status="info">Custom</Badge>
            ) : data?.mock ? (
              <Badge status="warning">Mock data</Badge>
            ) : data?.stale ? (
              <Badge status="attention">Stale</Badge>
            ) : (
              <Badge status="success">Live</Badge>
            )}
          </Stack>
        </Stack>

        {isLoading ? (
          <SkeletonDisplayText size="large" />
        ) : isError ? (
          <Text tone="critical">Unable to load rate.</Text>
        ) : (
          <Stack alignment="baseline" spacing="tight">
            <Text variant="heading2xl" as="p">
              {formatMoney(data.rate, data.currency, "en-IN")}
            </Text>
            <Text tone="subdued" as="span">
              / {data.unit} · {slotLabel}
            </Text>
          </Stack>
        )}

        <Text tone="subdued" variant="bodySm" as="p">
          Updated {formatRelativeTime(data?.timestamp)} · Source: {data?.source || "—"}
        </Text>

        {data?.mock ? (
          <Banner status="warning">
            No Metals.dev API key configured — showing a sample rate. Add your key in
            Settings to pull the live MCX rate.
          </Banner>
        ) : null}
        {data?.stale ? (
          <Banner status="attention">
            Showing the last known rate — the latest fetch from metals.dev didn’t
            succeed. It will recover automatically on the next refresh.
          </Banner>
        ) : null}

        <div>
          <Button onClick={() => refresh.mutate()} loading={refresh.isLoading}>
            Force refresh
          </Button>
        </div>
      </Stack>
    </Card>
  );
}
