import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { MAX_PAIR_ROWS } from "./limits";

export type DeliveryPayload = Doc<"deliveryJobs">["payload"];

function assertPayloadBounds(payload: DeliveryPayload): void {
  if (payload.kind === "email") {
    if (payload.to.length > 320 || payload.subject.length > 200) {
      throw new Error("Email delivery payload is too large");
    }
    if ((payload.text?.length ?? 0) > 8_000 || (payload.html?.length ?? 0) > 32_000) {
      throw new Error("Email delivery body is too large");
    }
  } else if (payload.kind === "push") {
    if (payload.title.length > 100 || payload.body.length > 500 || (payload.url?.length ?? 0) > 2_048) {
      throw new Error("Push delivery payload is too large");
    }
  } else if (payload.kind === "stripe_cancel" && payload.stripeSubscriptionId.length > 255) {
    throw new Error("Stripe subscription identifier is too large");
  } else if (payload.kind === "clerk_delete" && payload.clerkUserId.length > 255) {
    throw new Error("Clerk user identifier is too large");
  }
}

export async function enqueueDelivery(
  ctx: MutationCtx,
  dedupeKey: string,
  payload: DeliveryPayload,
  subjectUserId?: Id<"users">,
): Promise<Id<"deliveryJobs">> {
  const key = dedupeKey.trim();
  if (!key || key.length > 512) throw new Error("Invalid delivery dedupe key");
  assertPayloadBounds(payload);
  const existing = await ctx.db
    .query("deliveryJobs")
    .withIndex("by_dedupe", (q) => q.eq("dedupeKey", key))
    .take(MAX_PAIR_ROWS);
  if (existing[0]) {
    if (subjectUserId && !existing[0].subjectUserId) {
      await ctx.db.patch(existing[0]._id, { subjectUserId, updatedAt: Date.now() });
    }
    return existing[0]._id;
  }
  const now = Date.now();
  return await ctx.db.insert("deliveryJobs", {
    dedupeKey: key,
    subjectUserId,
    payload,
    state: "pending",
    attempts: 0,
    nextAttemptAt: now,
    createdAt: now,
    updatedAt: now,
  });
}
