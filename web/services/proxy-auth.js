// @ts-check
import crypto from "crypto";
import shopify from "../shopify.js";

/**
 * Express middleware that verifies an incoming Shopify App Proxy request.
 *
 * Shopify signs proxied storefront requests with the app's API secret. The
 * algorithm: take every query param except `signature`, sort by key, join each
 * as `key=value` (array values joined by ","), concatenate with no separator,
 * HMAC-SHA256 with the API secret, hex-encode, and compare to `signature`.
 *
 * On success, the verified shop domain is attached as `req.proxyShop`.
 */
export function verifyAppProxy(req, res, next) {
  try {
    const { signature, ...rest } = req.query;
    if (!signature || typeof signature !== "string") {
      return res.status(401).json({ error: "Missing proxy signature" });
    }

    const message = Object.keys(rest)
      .sort()
      .map((key) => {
        const value = rest[key];
        const joined = Array.isArray(value) ? value.join(",") : value;
        return `${key}=${joined}`;
      })
      .join("");

    const secret = process.env.SHOPIFY_API_SECRET || "";
    const digest = crypto
      .createHmac("sha256", secret)
      .update(message, "utf8")
      .digest("hex");

    const a = Buffer.from(digest, "utf8");
    const b = Buffer.from(signature, "utf8");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(401).json({ error: "Invalid proxy signature" });
    }

    req.proxyShop = String(req.query.shop || "");
    if (!req.proxyShop) {
      return res.status(400).json({ error: "Missing shop parameter" });
    }
    return next();
  } catch (error) {
    console.error("[proxy] verification error:", error.message);
    return res.status(401).json({ error: "Proxy verification failed" });
  }
}

/**
 * Load the offline session for a shop so proxy endpoints (which carry no user
 * session) can still call the Admin API on the merchant's behalf.
 * @param {string} shop
 */
export async function loadOfflineSession(shop) {
  const sessionId = shopify.api.session.getOfflineId(shop);
  const session = await shopify.config.sessionStorage.loadSession(sessionId);
  if (!session) {
    throw new Error(`No offline session found for ${shop}`);
  }
  return session;
}
