// Minimal Stripe REST client + webhook-signature verifier built on `fetch` and
// Web Crypto, so it runs in Convex's default V8 runtime (no Node action, no
// `stripe` npm dependency). We only need checkout sessions, billing-portal
// sessions, and HMAC signature verification — all stable Stripe primitives.
//
// TEST MODE until launch: keys come from process.env, set via
// `npx convex env set STRIPE_SECRET_KEY sk_test_…` (see SAAS-KIT.md). Swap to
// sk_live_… to charge real cards. (`process` is declared globally in env.d.ts.)

const STRIPE_API = "https://api.stripe.com/v1";

function isLocalDevHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

// Checkout/portal return URLs come from the client. Only the deployment
// origin (SITE_URL) and local dev hosts are allowed, so a signed-in user
// cannot send Stripe's redirect to an attacker site.
export function assertSafeReturnUrl(
  url: string,
  opts?: { siteUrl?: string },
): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Return URL is not a valid URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Return URL must be http or https");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Return URL must not include credentials");
  }
  const site = (opts?.siteUrl ?? process.env.SITE_URL ?? "").trim();
  const siteOrigin = site ? originOf(site) : null;
  const siteIsLocalHttp =
    !!site &&
    (() => {
      try {
        const s = new URL(site);
        return s.protocol === "http:" && isLocalDevHost(s.hostname);
      } catch {
        return false;
      }
    })();
  const allowLoopback = !site || siteIsLocalHttp;
  if (allowLoopback && isLocalDevHost(parsed.hostname) && parsed.protocol === "http:") {
    return;
  }
  if (siteOrigin && parsed.origin === siteOrigin) return;
  if (!site) {
    throw new Error("Set SITE_URL on the deployment for checkout return URLs");
  }
  throw new Error("Return URL origin is not allowed");
}

export function stripeSecretKey(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY is not configured (set it with `npx convex env set STRIPE_SECRET_KEY sk_test_…`)",
    );
  }
  return key;
}

export function stripeWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error(
      "STRIPE_WEBHOOK_SECRET is not configured (set it with `npx convex env set STRIPE_WEBHOOK_SECRET whsec_…`)",
    );
  }
  return secret;
}

// stripeProPriceId returns the Stripe Price id for the Pro tier. Created once in
// the Stripe dashboard / CLI (see SAAS-KIT.md) and wired via env.
export function stripeProPriceId(): string {
  const price = process.env.STRIPE_PRICE_PRO;
  if (!price) {
    throw new Error(
      "STRIPE_PRICE_PRO is not configured (set it with `npx convex env set STRIPE_PRICE_PRO price_…`)",
    );
  }
  return price;
}

// stripeForm POSTs an application/x-www-form-urlencoded body to the Stripe REST
// API (Stripe does not accept JSON). Nested params use bracket notation, which
// flattenForm produces. Throws on a non-2xx response with Stripe's error.
async function stripeForm(path: string, params: Record<string, unknown>): Promise<any> {
  const body = new URLSearchParams(flattenForm(params)).toString();
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeSecretKey()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const json = await res.json();
  if (!res.ok) {
    const msg = json?.error?.message ?? `Stripe ${path} failed (${res.status})`;
    throw new Error(`Stripe error: ${msg}`);
  }
  return json;
}

export async function cancelStripeSubscriptionAtProvider(
  stripeSubscriptionId: string,
): Promise<void> {
  const res = await fetch(`${STRIPE_API}/subscriptions/${stripeSubscriptionId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${stripeSecretKey()}` },
  });
  if (!res.ok && res.status !== 404) {
    const json = await res.json().catch(() => ({}));
    const msg = (json as { error?: { message?: string } })?.error?.message ?? res.status;
    throw new Error(`Stripe cancel failed: ${msg}`);
  }
}

// flattenForm turns a nested object into Stripe's bracketed form encoding:
//   { line_items: [{ price: "p", quantity: 1 }] }
//     → line_items[0][price]=p, line_items[0][quantity]=1
export function flattenForm(
  obj: Record<string, unknown>,
  prefix = "",
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(obj)) {
    if (val === undefined || val === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(val)) {
      val.forEach((item, i) => {
        if (typeof item === "object" && item !== null) {
          Object.assign(out, flattenForm(item as Record<string, unknown>, `${key}[${i}]`));
        } else {
          out[`${key}[${i}]`] = String(item);
        }
      });
    } else if (typeof val === "object") {
      Object.assign(out, flattenForm(val as Record<string, unknown>, key));
    } else {
      out[key] = String(val);
    }
  }
  return out;
}

export interface CheckoutSessionArgs {
  priceId: string;
  quantity?: number;
  successUrl: string;
  cancelUrl: string;
  clientReferenceId: string; // our user id — echoed back on the webhook
  customerEmail?: string;
  stripeCustomerId?: string;
  metadata?: Record<string, string>;
}

// createCheckoutSession opens a Stripe Checkout session for a recurring
// subscription. The returned `url` is where the browser is redirected to pay.
// We stamp our reference id onto BOTH the session (client_reference_id) and the
// subscription (subscription_data.metadata) so every later webhook can resolve it.
export async function createCheckoutSession(
  args: CheckoutSessionArgs,
): Promise<{ id: string; url: string }> {
  const params: Record<string, unknown> = {
    mode: "subscription",
    success_url: args.successUrl,
    cancel_url: args.cancelUrl,
    client_reference_id: args.clientReferenceId,
    line_items: [{ price: args.priceId, quantity: args.quantity ?? 1 }],
    "subscription_data[metadata][refId]": args.clientReferenceId,
    allow_promotion_codes: "true",
  };
  if (args.stripeCustomerId) params.customer = args.stripeCustomerId;
  else if (args.customerEmail) params.customer_email = args.customerEmail;
  if (args.metadata) {
    for (const [k, v] of Object.entries(args.metadata)) params[`metadata[${k}]`] = v;
  }
  const session = await stripeForm("/checkout/sessions", params);
  return { id: session.id, url: session.url };
}

// createBillingPortalSession opens the Stripe-hosted billing portal so a customer
// can manage/cancel their subscription. Requires an existing Stripe customer id.
export async function createBillingPortalSession(args: {
  stripeCustomerId: string;
  returnUrl: string;
}): Promise<{ url: string }> {
  const session = await stripeForm("/billing_portal/sessions", {
    customer: args.stripeCustomerId,
    return_url: args.returnUrl,
  });
  return { url: session.url };
}

// --- Webhook signature verification (Stripe `t=…,v1=…` scheme) ---------------
//
// Stripe signs each webhook with HMAC-SHA256 over `${timestamp}.${rawBody}` using
// the endpoint's signing secret. We verify it with Web Crypto (no `stripe` dep).
// Reference: stripe.com/docs/webhooks/signatures.

const SIGNATURE_TOLERANCE_SECONDS = 300;

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// verifyStripeSignature returns true when `header` is a valid signature of
// `payload` under `secret`, within the timestamp tolerance. `nowSeconds` is
// injectable for tests.
export async function verifyStripeSignature(
  payload: string,
  header: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const idx = kv.indexOf("=");
      return [kv.slice(0, idx).trim(), kv.slice(idx + 1).trim()];
    }),
  );
  const timestamp = parts["t"];
  const expected = parts["v1"];
  if (!timestamp || !expected) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(nowSeconds - ts) > SIGNATURE_TOLERANCE_SECONDS) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${timestamp}.${payload}`));
  return timingSafeEqualHex(toHex(sig), expected);
}
