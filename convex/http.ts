import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { auth } from "./auth";
import { internal } from "./_generated/api";
import { verifyStripeSignature, stripeWebhookSecret } from "./lib/stripe";

// Wire Convex Auth's HTTP routes (token exchange, OAuth callbacks).
const http = httpRouter();
auth.addHttpRoutes(http);

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

http.route({
  path: "/stripe/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const sig = request.headers.get("stripe-signature");
    const payload = await request.text();
    if (!sig) return new Response("Missing stripe-signature", { status: 400 });

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

    switch (event.type) {
      case "checkout.session.completed": {
        // client_reference_id is the userId we set when creating the session.
        const userId = obj.client_reference_id ?? obj.metadata?.refId;
        if (!userId) break;
        if (!(await ctx.runQuery(internal.billing.userExists, { userId }))) break;
        await ctx.runMutation(internal.billing.upsertSubscription, {
          userId: userId as any,
          plan: "pro",
          status: "active",
          stripeCustomerId: typeof obj.customer === "string" ? obj.customer : undefined,
          stripeSubscriptionId: typeof obj.subscription === "string" ? obj.subscription : undefined,
        });
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const userId = obj.metadata?.refId;
        if (!userId) break;
        if (!(await ctx.runQuery(internal.billing.userExists, { userId }))) break;
        await ctx.runMutation(internal.billing.upsertSubscription, {
          userId: userId as any,
          plan: "pro",
          status: normalizeStatus(obj.status),
          stripeCustomerId: typeof obj.customer === "string" ? obj.customer : undefined,
          stripeSubscriptionId: typeof obj.id === "string" ? obj.id : undefined,
          currentPeriodEnd:
            typeof obj.current_period_end === "number" ? obj.current_period_end * 1000 : undefined,
        });
        break;
      }
      case "customer.subscription.deleted": {
        if (typeof obj.id === "string") {
          await ctx.runMutation(internal.billing.cancelSubscription, { stripeSubscriptionId: obj.id });
        }
        break;
      }
      default:
        break; // ack unhandled events
    }

    return Response.json({ received: true });
  }),
});

export default http;
