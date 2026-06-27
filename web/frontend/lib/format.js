// Formatting helpers + thin fetch wrapper.
// App Bridge v4 automatically attaches the session token to same-origin
// `/api/*` fetches, so a plain fetch is all we need.

export function formatMoney(amount, currency = "INR", locale = "en-IN") {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(Number(amount) || 0);
  } catch (e) {
    return `${currency} ${(Number(amount) || 0).toFixed(2)}`;
  }
}

export function formatNumber(amount, locale = "en-IN", digits = 2) {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: digits,
  }).format(Number(amount) || 0);
}

export function formatRelativeTime(iso) {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "never";
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 5) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleString();
}

export async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (e) {
    body = { raw: text };
  }
  if (!res.ok) {
    const message = body?.error || body?.raw || `Request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}
