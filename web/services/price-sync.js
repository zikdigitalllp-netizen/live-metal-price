// @ts-check
import shopify from "../shopify.js";
import { fetchSyncTargets } from "./product-pricing.js";
import { saveSettings } from "./settings.js";

/**
 * Push computed final prices into Shopify variant prices.
 *
 * Why: a storefront script can DISPLAY any price, but Shopify's cart and
 * checkout charge the variant price. To make checkout reflect the live
 * calculated value with no discrepancy — and without relying on metafields or
 * Shopify Functions — we write the computed final price onto each enabled
 * product's variants via `productVariantsBulkUpdate`. After a sync, the
 * variant price IS the calculated price, so add-to-cart and checkout match.
 *
 * This runs on demand (admin "Sync now") and, optionally, automatically each
 * time the rate is refreshed (see settings.auto_sync_on_refresh).
 */

const BULK_UPDATE = `
  mutation BulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      product { id }
      productVariants { id price }
      userErrors { field message }
    }
  }
`;

/**
 * Sync all enabled products' variant prices to their computed final price.
 * @param {import("@shopify/shopify-api").Session} session
 * @param {object} settings
 * @returns {Promise<{updated:number, skipped:number, failed:number, errors:string[], silverRate:any}>}
 */
export async function syncPricesToShopify(session, settings) {
  const client = new shopify.api.clients.Graphql({ session });
  const { targets, silverRate } = await fetchSyncTargets(session, settings);

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const errors = [];

  for (const product of targets) {
    const price = Number(product.calculatedPrice);
    if (!Number.isFinite(price) || price <= 0 || !product.variantIds?.length) {
      skipped++;
      continue;
    }

    const compareAtPrice = Number(product.compareAtPrice);
    const variants = product.variantIds.map((id) => {
      const variantUpdate = { id, price: price.toFixed(2) };
      if (Number.isFinite(compareAtPrice) && compareAtPrice > 0) {
        variantUpdate.compareAtPrice = compareAtPrice.toFixed(2);
      }
      return variantUpdate;
    });

    try {
      const resp = await client.request(BULK_UPDATE, {
        variables: { productId: product.gid, variants },
      });
      const userErrors = resp?.data?.productVariantsBulkUpdate?.userErrors || [];
      if (userErrors.length) {
        failed++;
        errors.push(`${product.title}: ${userErrors.map((e) => e.message).join(", ")}`);
      } else {
        updated++;
      }
    } catch (error) {
      failed++;
      errors.push(`${product.title}: ${error.message}`);
    }
  }

  await saveSettings(session, { last_price_sync_time: new Date().toISOString() });

  return { updated, skipped, failed, errors: errors.slice(0, 20), silverRate };
}
