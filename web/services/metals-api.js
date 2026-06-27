// @ts-check
import NodeCache from "node-cache";

/**
 * Live MCX silver-rate provider (metals.dev), matching the verified request in
 * test-api.html exactly:
 *
 *   GET https://api.metals.dev/v1/metal/authority
 *       ?api_key=<key>&authority=mcx&currency=INR&unit=g
 *
 * Rate selection is IST time-of-day aware:
 *   - 09:00–20:59 IST  ->  rates.mcx_silver_am
 *   - 21:00–08:59 IST  ->  rates.mcx_silver_pm
 *   with a fallback chain (am -> pm -> mcx_silver -> rate) when a value is null.
 *
 * Optimization: Only fetches new rate from API twice daily at 9 AM and 9 PM IST
 *
 * Resilience:
 *   - Last-good value is retained and served if a later fetch fails.
 *   - Deterministic mock fallback when no API key is configured, so the whole
 *     app + storefront remain testable before a key is added.
 */

const CACHE_KEY = "mcx_silver_rate";
const LAST_GOOD_KEY = "mcx_silver_rate_last_good";
const LAST_FETCH_TIME_KEY = "mcx_silver_rate_last_fetch_time";
const PROVIDER_URL = "https://api.metals.dev/v1/metal/authority";
const MOCK_RATE_INR_PER_GRAM = 240;

// Persist cache for longer since we only update twice daily
const cache = new NodeCache({ stdTTL: 60 * 60 * 24 * 2, checkperiod: 60 * 60 }); // 2 days TTL

/** Current hour (0–23) in India Standard Time, regardless of server timezone. */
export function istHour(date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      hour12: false,
    }).formatToParts(date);
    const h = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
    return Number.isFinite(h) ? h % 24 : 0;
  } catch {
    // Fallback: compute IST as UTC + 5:30.
    const utc = date.getTime() + date.getTimezoneOffset() * 60000;
    return new Date(utc + 5.5 * 3600000).getHours();
  }
}

/** Which slot applies right now: 'am' for 09:00–20:59 IST, else 'pm'. */
export function istSlot(date = new Date()) {
  const h = istHour(date);
  return h >= 9 && h < 21 ? "am" : "pm";
}

/** Pick the live rate from the provider payload using the IST slot + fallbacks. */
function selectRate(payload, slot) {
  const rates = payload?.rates || {};
  const am = Number(rates.mcx_silver_am);
  const pm = Number(rates.mcx_silver_pm);
  const primary = slot === "am" ? am : pm;

  const chain = [
    primary,
    am,
    pm,
    Number(rates.mcx_silver),
    Number(payload?.rate),
  ];
  for (const c of chain) {
    if (Number.isFinite(c) && c > 0) return c;
  }
  return null;
}

function mockData() {
  const slot = istSlot();
  return {
    rate: MOCK_RATE_INR_PER_GRAM,
    currency: "INR",
    unit: "g",
    metal: "silver",
    authority: "mcx",
    slot,
    rate_am: MOCK_RATE_INR_PER_GRAM,
    rate_pm: MOCK_RATE_INR_PER_GRAM,
    timestamp: new Date().toISOString(),
    source: "mock",
    mock: true,
  };
}

/**
 * Check if we should fetch a new rate from the API
 * Only fetch at 9 AM and 9 PM IST (i.e., at the start of each 12-hour slot)
 */
function shouldFetchNewRate(now = new Date()) {
  const lastFetchStr = cache.get(LAST_FETCH_TIME_KEY);
  if (!lastFetchStr) return true; // No previous fetch, definitely fetch

  const lastFetch = new Date(lastFetchStr);

  // Get dates in IST
  const nowISTStr = now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
  const lastFetchISTStr = lastFetch.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
  const nowIST = new Date(nowISTStr);
  const lastFetchIST = new Date(lastFetchISTStr);

  // Determine if we're in a different 12-hour period
  const currentIsAM = istHour(now) >= 9 && istHour(now) < 21;
  const lastFetchIsAM = istHour(lastFetch) >= 9 && istHour(lastFetch) < 21;

  if (currentIsAM !== lastFetchIsAM) {
    return true; // Different AM/PM period, fetch new
  }

  // Check if today is different from last fetch day
  if (nowIST.getDate() !== lastFetchIST.getDate() ||
      nowIST.getMonth() !== lastFetchIST.getMonth() ||
      nowIST.getFullYear() !== lastFetchIST.getFullYear()) {
    return true;
  }

  return false;
}

/**
 * Fetch the current MCX silver rate (INR per gram) or use custom price.
 * @param {string} apiKey
 * @param {{use_custom_silver_price?:boolean, custom_silver_price?:number|null}} [settings]
 * @returns {Promise<{rate:number, currency:string, unit:string, metal:string,
 *   authority:string, slot:string, rate_am:number|null, rate_pm:number|null,
 *   timestamp:string, source:string, mock:boolean, stale?:boolean, custom?:boolean}>}
 */
export async function fetchMCXSilverRate(apiKey, settings = {}) {
  const cached = cache.get(CACHE_KEY);
  const slot = istSlot();

  // Return cached if we shouldn't fetch new
  if (cached && !shouldFetchNewRate()) {
    // Update slot if needed but keep price
    if (cached.slot !== slot) {
      const updated = { ...cached, slot, timestamp: new Date().toISOString() };
      cache.set(CACHE_KEY, updated);
      return updated;
    }
    return cached;
  }

  // Use custom price if enabled
  if (settings.use_custom_silver_price && settings.custom_silver_price !== null && Number.isFinite(settings.custom_silver_price) && settings.custom_silver_price > 0) {
    const data = {
      rate: settings.custom_silver_price,
      currency: "INR",
      unit: "g",
      metal: "silver",
      authority: "mcx",
      slot,
      rate_am: settings.custom_silver_price,
      rate_pm: settings.custom_silver_price,
      timestamp: new Date().toISOString(),
      source: "custom",
      mock: false,
      custom: true,
    };
    cache.set(CACHE_KEY, data);
    return data;
  }

  // No key -> deterministic mock so nothing downstream breaks.
  if (!apiKey) {
    const data = mockData();
    cache.set(CACHE_KEY, data);
    return data;
  }

  const url =
    `${PROVIDER_URL}?api_key=${encodeURIComponent(apiKey)}` +
    `&authority=mcx&currency=INR&unit=g`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!response.ok) {
      throw new Error(`metals.dev request failed (status ${response.status})`);
    }
    const payload = await response.json();

    const rate = selectRate(payload, slot);
    if (rate === null) {
      throw new Error(
        "metals.dev response did not contain an MCX silver rate (check key / plan)"
      );
    }

    const rates = payload?.rates || {};
    const data = {
      rate,
      currency: payload?.currency || "INR",
      unit: payload?.unit || "g",
      metal: "silver",
      authority: "mcx",
      slot,
      rate_am: Number.isFinite(Number(rates.mcx_silver_am)) ? Number(rates.mcx_silver_am) : null,
      rate_pm: Number.isFinite(Number(rates.mcx_silver_pm)) ? Number(rates.mcx_silver_pm) : null,
      timestamp: payload?.timestamp || new Date().toISOString(),
      source: "metals.dev",
      mock: false,
    };

    cache.set(CACHE_KEY, data);
    cache.set(LAST_GOOD_KEY, data, 0); // keep last-good with no TTL
    cache.set(LAST_FETCH_TIME_KEY, new Date().toISOString(), 0); // Keep fetch time with no TTL
    return data;
  } catch (error) {
    // Serve last-good value if we have one, so the storefront never breaks.
    const lastGood = cache.get(LAST_GOOD_KEY);
    if (lastGood) {
      const stale = { ...lastGood, slot, stale: true, timestamp: new Date().toISOString() };
      cache.set(CACHE_KEY, stale);
      return stale;
    }
    console.error("[metals-api] fetch failed, no last-good value:", error.message);
    const data = { ...mockData(), source: "mock-fallback" };
    cache.set(CACHE_KEY, data);
    return data;
  }
}

export function invalidateCache() {
  cache.del(CACHE_KEY);
  // Also reset last fetch time when invalidating
  cache.del(LAST_FETCH_TIME_KEY);
}
