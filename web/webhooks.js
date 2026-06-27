// @ts-check
import { DeliveryMethod } from "@shopify/shopify-api";
import PrivacyWebhookHandlers from "./privacy.js";
import { clearSettingsCache } from "./services/settings.js";
import { clearConfigCache } from "./services/product-config.js";

/**
 * All webhook topics this app subscribes to. The mandatory privacy/GDPR
 * webhooks are merged with an APP_UNINSTALLED handler that cleans up local
 * state (sessions + cached settings) when a merchant removes the app.
 *
 * @type {{[key: string]: import("@shopify/shopify-api").WebhookHandler}}
 */
const WebhookHandlers = {
  ...PrivacyWebhookHandlers,

  APP_UNINSTALLED: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async (_topic, shop) => {
      try {
        clearSettingsCache(shop);
        clearConfigCache(shop);
        console.log(`[webhook] app uninstalled, cleaned cache for ${shop}`);
      } catch (error) {
        console.error("[webhook] APP_UNINSTALLED cleanup failed:", error.message);
      }
    },
  },
};

export default WebhookHandlers;
