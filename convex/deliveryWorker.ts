"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { cancelStripeSubscriptionAtProvider } from "./lib/stripe";
import { deleteClerkUser } from "./lib/clerk";

export const run = internalAction({
  args: { jobId: v.id("deliveryJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.runQuery(internal.delivery.get, { jobId });
    if (!job || job.state !== "processing") return { outcome: "ignored" as const };
    try {
      let providerId: string | undefined;
      if (job.payload.kind === "email") {
        const result = await ctx.runAction(internal.emails.sendEmail, {
          to: job.payload.to,
          subject: job.payload.subject,
          text: job.payload.text,
          html: job.payload.html,
          idempotencyKey: job.dedupeKey,
        });
        providerId = result.id;
      } else if (job.payload.kind === "push") {
        const result = await ctx.runAction(internal.pushSend.sendToUser, {
          userId: job.payload.userId,
          title: job.payload.title,
          body: job.payload.body,
          url: job.payload.url,
          tag: jobId,
        });
        if (result.failed > 0 && result.sent === 0) {
          throw new Error(`push provider failed for ${result.failed} subscription(s)`);
        }
        providerId = `sent=${result.sent};dropped=${result.dropped};failed=${result.failed}`;
      } else if (job.payload.kind === "stripe_cancel") {
        await cancelStripeSubscriptionAtProvider(job.payload.stripeSubscriptionId);
        await ctx.runMutation(internal.billing.cancelSubscription, {
          stripeSubscriptionId: job.payload.stripeSubscriptionId,
        });
        providerId = job.payload.stripeSubscriptionId;
      } else {
        await deleteClerkUser(job.payload.clerkUserId);
        await ctx.runMutation(internal.externalAuth.completeClerkDeletion, {
          clerkUserId: job.payload.clerkUserId,
        });
        providerId = job.payload.clerkUserId;
      }
      await ctx.runMutation(internal.delivery.succeed, { jobId, providerId });
      return { outcome: "succeeded" as const };
    } catch (error) {
      const message = error instanceof Error ? error.message : "provider delivery failed";
      await ctx.runMutation(internal.delivery.fail, { jobId, error: message });
      return { outcome: "retrying" as const };
    }
  },
});
