"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { validPushSubscriptionKeys } from "./lib/pushEndpoint";
import { pushIsEnabled } from "./lib/runtime";

// Out-of-band Web Push. VAPID keys are operator-gated:
//   npx web-push generate-vapid-keys
//   npx convex env set VAPID_PUBLIC_KEY … VAPID_PRIVATE_KEY …
// Without keys this action no-ops so local tests stay hermetic.

export const sendToUser = internalAction({
  args: {
    userId: v.id("users"),
    title: v.string(),
    body: v.string(),
    url: v.optional(v.string()),
    tag: v.optional(v.string()),
  },
  handler: async (ctx, { userId, title, body, url, tag }) => {
    if (!pushIsEnabled()) return { sent: 0, dropped: 0, failed: 0 };
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    if (!publicKey || !privateKey) return { sent: 0, dropped: 0, failed: 0 };
    const pkg = "web-push";
    const loaded = await import(pkg);
    const webpush = ((loaded as { default?: unknown }).default ?? loaded) as {
      setVapidDetails: (subject: string, pub: string, priv: string) => void;
      sendNotification: (
        sub: { endpoint: string; keys: { p256dh: string; auth: string } },
        payload: string,
        options?: { TTL?: number; timeout?: number },
      ) => Promise<unknown>;
    };
    const subject = process.env.VAPID_SUBJECT || "mailto:openbook@localhost";
    webpush.setVapidDetails(subject, publicKey, privateKey);
    const subs = await ctx.runQuery(internal.push.forUser, { userId });
    let sent = 0;
    let dropped = 0;
    let failed = 0;
    for (const sub of subs) {
      if (!validPushSubscriptionKeys(sub.p256dh, sub.auth)) {
        await ctx.runMutation(internal.push.drop, { id: sub._id });
        dropped += 1;
        continue;
      }
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ title, body, url: url ?? "/", tag: tag?.slice(0, 128) }),
          { TTL: 60, timeout: 15_000 },
        );
        sent += 1;
      } catch (err) {
        const status = (err as { statusCode?: number } | null)?.statusCode;
        if (status === 404 || status === 410) {
          await ctx.runMutation(internal.push.drop, { id: sub._id });
          dropped += 1;
        } else {
          failed += 1;
        }
      }
    }
    return { sent, dropped, failed };
  },
});
