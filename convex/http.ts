import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { auth } from "./auth";
import { internal } from "./_generated/api";
import { verifyStripeSignature, stripeWebhookSecret } from "./lib/stripe";
import { billingIsEnabled, runtimeMetadata } from "./lib/runtime";
import { configuredAuthMode } from "./lib/authIdentity";
import { BoundedBodyError, readBoundedText } from "./lib/httpBody";
import { MAX_MEDIA_RESPONSE_BYTES } from "./lib/limits";
import { mediaCacheControl, parseMediaRange, verifyMedia } from "./lib/mediaSign";

// Wire Convex Auth's HTTP routes (token exchange, OAuth callbacks).
const http = httpRouter();
if (configuredAuthMode() === "convex-auth") auth.addHttpRoutes(http);

// --- Stripe billing webhook --------------------------------------------------
//
// Stripe POSTs subscription lifecycle events here. We verify the HMAC signature
// against STRIPE_WEBHOOK_SECRET, then map the event to the subscriptions table
// via internal mutations. We ack (200) anything we don't act on so Stripe stops
// retrying, but reject (400) bad signatures so a forged event can't mutate state.

function normalizeStatus(s: string | undefined): "active" | "trialing" | "past_due" | "canceled" {
  switch (s) {
    case "active": return "active";
    case "trialing": return "trialing";
    case "past_due":
    case "unpaid":
    case "incomplete":
    case "incomplete_expired": return "past_due";
    case "canceled": return "canceled";
    default: return "past_due";
  }
}

function timingSafeTextEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

async function sourceHash(request: Request): Promise<string> {
  const source =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  const secret = (process.env.CLIENT_ERROR_HASH_SECRET ?? "").trim();
  if (secret.length < 32) throw new Error("Client telemetry is not configured");
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(source));
  return Array.from(new Uint8Array(signature))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function telemetryCorsHeaders(request: Request): Record<string, string> | null {
  const allowed = (process.env.SITE_URL ?? "").replace(/\/$/, "");
  const origin = request.headers.get("origin") ?? "";
  if (!allowed || origin !== allowed) return null;
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
  };
}

function publicStatusHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  const origin = (process.env.SITE_URL ?? "").replace(/\/$/, "");
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers.Vary = "Origin";
  }
  return headers;
}

function boundedBodyFailure(
  error: unknown,
  headers: Record<string, string> = {},
): Response {
  if (error instanceof BoundedBodyError) {
    return new Response(error.message, { status: error.status, headers });
  }
  return new Response("Could not read request body", { status: 400, headers });
}

http.route({
  path: "/stripe/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!billingIsEnabled()) return new Response("Not found", { status: 404 });
    const sig = request.headers.get("stripe-signature");
    if (!sig) return new Response("Missing stripe-signature", { status: 400 });
    let payload: string;
    try {
      payload = await readBoundedText(request, 64 << 10);
    } catch (error) {
      return boundedBodyFailure(error);
    }

    let secret: string;
    try {
      secret = stripeWebhookSecret();
    } catch (e: any) {
      return new Response(e?.message ?? "Webhook not configured", { status: 500 });
    }
    if (!(await verifyStripeSignature(payload, sig, secret))) {
      return new Response("Invalid signature", { status: 400 });
    }

    let event: any;
    try {
      event = JSON.parse(payload);
    } catch {
      return new Response("Bad JSON", { status: 400 });
    }
    const obj = event?.data?.object ?? {};
    const eventId = typeof event?.id === "string" ? event.id : "";
    const eventCreatedAt =
      typeof event?.created === "number" ? event.created * 1000 : Number.NaN;
    if (!eventId || eventId.length > 255 || !Number.isFinite(eventCreatedAt)) {
      return new Response("Invalid event envelope", { status: 400 });
    }

    switch (event.type) {
      case "checkout.session.completed": {
        // client_reference_id is the userId we set when creating the session.
        const userId = obj.client_reference_id ?? obj.metadata?.refId;
        await ctx.runMutation(internal.billing.applyStripeEvent, {
          eventId,
          eventType: event.type,
          eventCreatedAt,
          userId: typeof userId === "string" ? userId : undefined,
          status: "active",
          stripeCustomerId: typeof obj.customer === "string" ? obj.customer : undefined,
          stripeSubscriptionId: typeof obj.subscription === "string" ? obj.subscription : undefined,
        });
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const userId = obj.metadata?.refId;
        await ctx.runMutation(internal.billing.applyStripeEvent, {
          eventId,
          eventType: event.type,
          eventCreatedAt,
          userId: typeof userId === "string" ? userId : undefined,
          status: normalizeStatus(obj.status),
          stripeCustomerId: typeof obj.customer === "string" ? obj.customer : undefined,
          stripeSubscriptionId: typeof obj.id === "string" ? obj.id : undefined,
          currentPeriodEnd:
            typeof obj.current_period_end === "number" ? obj.current_period_end * 1000 : undefined,
        });
        break;
      }
      case "customer.subscription.deleted": {
        await ctx.runMutation(internal.billing.applyStripeEvent, {
          eventId,
          eventType: event.type,
          eventCreatedAt,
          stripeSubscriptionId: typeof obj.id === "string" ? obj.id : undefined,
        });
        break;
      }
      default: {
        await ctx.runMutation(internal.billing.applyStripeEvent, {
          eventId,
          eventType: typeof event.type === "string" ? event.type : "unknown",
          eventCreatedAt,
        });
        break;
      }
    }

    return Response.json({ received: true });
  }),
});

http.route({
  path: "/client-errors",
  method: "OPTIONS",
  handler: httpAction(async (_ctx, request) => {
    const headers = telemetryCorsHeaders(request);
    return headers
      ? new Response(null, { status: 204, headers })
      : new Response("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
  }),
});

http.route({
  path: "/client-errors",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const headers = telemetryCorsHeaders(request);
    if (!headers) return new Response("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
    let raw: string;
    try {
      raw = await readBoundedText(request, 8_192);
    } catch (error) {
      return boundedBodyFailure(error, headers);
    }
    let body: {
      fingerprint?: unknown;
      kind?: unknown;
      message?: unknown;
      stack?: unknown;
      route?: unknown;
      release?: unknown;
      environment?: unknown;
    };
    try {
      body = JSON.parse(raw) as typeof body;
    } catch {
      return new Response("Bad JSON", { status: 400, headers });
    }
    if (
      typeof body.fingerprint !== "string" ||
      (body.kind !== "error" && body.kind !== "unhandledrejection") ||
      typeof body.message !== "string" ||
      (body.stack !== undefined && typeof body.stack !== "string") ||
      typeof body.route !== "string" ||
      typeof body.release !== "string" ||
      typeof body.environment !== "string"
    ) {
      return new Response("Invalid report", { status: 400, headers });
    }
    try {
      await ctx.runMutation(internal.clientTelemetry.ingest, {
        sourceHash: await sourceHash(request),
        fingerprint: body.fingerprint,
        kind: body.kind,
        message: body.message,
        stack: body.stack,
        route: body.route,
        release: body.release,
        environment: body.environment,
      });
      return new Response(null, { status: 202, headers });
    } catch (error) {
      const limited = error instanceof Error && error.message.includes("Rate limit exceeded");
      return new Response(limited ? "Too many reports" : "Report rejected", {
        status: limited ? 429 : 400,
        headers,
      });
    }
  }),
});

http.route({
  path: "/ops/load",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = (process.env.OPENBOOK_SYNTHETIC_KEY ?? "").trim();
    const supplied = request.headers.get("authorization") ?? "";
    if (secret.length < 32 || !timingSafeTextEqual(supplied, `Bearer ${secret}`)) {
      return new Response("Not found", {
        status: 404,
        headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
      });
    }
    let raw: string;
    try {
      raw = await readBoundedText(request, 1_024);
    } catch (error) {
      return boundedBodyFailure(error, {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
    }
    let body: { operation?: unknown; nonce?: unknown };
    try {
      body = JSON.parse(raw) as typeof body;
    } catch {
      return new Response("Bad JSON", { status: 400 });
    }
    if (body.operation !== "read" && body.operation !== "write") {
      return new Response("Invalid operation", { status: 400 });
    }
    if (body.operation === "write") {
      if (typeof body.nonce !== "string") return new Response("Invalid nonce", { status: 400 });
      await ctx.runMutation(internal.loadProbe.write, { nonce: body.nonce });
    } else {
      await ctx.runQuery(internal.loadProbe.read, {});
    }
    const metadata = runtimeMetadata();
    return Response.json(
      { ok: true, operation: body.operation, release: metadata.release },
      { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } },
    );
  }),
});

http.route({
  path: "/media",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const id = url.searchParams.get("id") ?? "";
    const exp = Number(url.searchParams.get("exp") ?? "0");
    const sig = url.searchParams.get("sig") ?? "";
    if (!(await verifyMedia(id, exp, sig))) {
      return new Response("Not found", { status: 404 });
    }
    try {
      const blob = await ctx.storage.get(id as never);
      if (!blob) return new Response("Not found", { status: 404 });
      if (blob.size <= 0 || blob.size > MAX_MEDIA_RESPONSE_BYTES) {
        return new Response("Not found", { status: 404 });
      }
      const range = parseMediaRange(request.headers.get("range"), blob.size);
      const headers: Record<string, string> = {
        "Accept-Ranges": "bytes",
        "Content-Type": blob.type || "application/octet-stream",
        "Cache-Control": mediaCacheControl(exp),
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "X-Content-Type-Options": "nosniff",
      };
      if (range === null) {
        headers["Content-Range"] = `bytes */${blob.size}`;
        return new Response(null, { status: 416, headers });
      }
      if (range) {
        const body = blob.slice(range.start, range.end + 1, blob.type);
        headers["Content-Length"] = String(body.size);
        headers["Content-Range"] = `bytes ${range.start}-${range.end}/${blob.size}`;
        return new Response(body, { status: 206, headers });
      }
      headers["Content-Length"] = String(blob.size);
      return new Response(blob, { headers });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  }),
});

http.route({
  path: "/health",
  method: "GET",
  handler: httpAction(async () => {
    const metadata = runtimeMetadata();
    return Response.json({
      ok: true,
      service: "openbook",
      environment: metadata.environment,
      release: metadata.release,
    }, {
      headers: publicStatusHeaders(),
    });
  }),
});

http.route({
  path: "/ready",
  method: "GET",
  handler: httpAction(async (ctx) => {
    const metadata = runtimeMetadata();
    try {
      const state = await ctx.runQuery(internal.health.readiness, { now: Date.now() });
      return Response.json({
        ...state,
        service: "openbook",
        environment: metadata.environment,
        release: metadata.release,
      }, {
        status: state.ok ? 200 : 503,
        headers: publicStatusHeaders(),
      });
    } catch {
      return Response.json({
        ok: false,
        service: "openbook",
        environment: metadata.environment,
        release: metadata.release,
        database: false,
        maintenance: false,
        delivery: false,
        accountDeletion: false,
        migrations: false,
        configuration: false,
        maintenanceUpdatedAt: null,
        deliveryUpdatedAt: null,
        staleMaintenanceJobs: ["unavailable"],
        deadDeliveries: -1,
        overdueDeliveries: -1,
        staleAccountDeletions: -1,
        requiredMigration: "missing",
      }, {
        status: 503,
        headers: publicStatusHeaders(),
      });
    }
  }),
});

export default http;
