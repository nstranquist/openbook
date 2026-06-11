import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

// Plan model for Openbook — the single source of truth every gate reads.
// The free tier caps lifetime posts; Pro is unlimited. `null` = unlimited.
export type Plan = "free" | "pro";

export interface PlanLimits {
  posts: number | null;
}

const LIMITS: Record<Plan, PlanLimits> = {
  free: { posts: 100 },
  pro: { posts: null },
};

export function planLimits(plan: Plan): PlanLimits {
  return LIMITS[plan] ?? LIMITS.free;
}

// Monthly price in USD cents. Free is $0; only `pro` is self-serve checkout.
export const PLAN_PRICE_CENTS: Record<Plan, number | null> = {
  free: 0,
  pro: 900, // $9 / mo — match STRIPE_PRICE_PRO in your Stripe account
};

// Subscription statuses that entitle a user to their subscription's plan.
// Anything else (past_due/canceled) falls back to free. Kept in sync by the
// billing webhook (see billing.ts).
const ENTITLING_SUB_STATUSES = new Set(["active", "trialing"]);

// effectivePlan resolves a user's billable plan: an entitling subscription wins;
// otherwise free. Every gate should consult THIS — never assume free/pro from a
// raw column — so a lapsed subscription downgrades correctly even before any
// webhook lands.
export async function effectivePlan(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<Plan> {
  const sub = await ctx.db
    .query("subscriptions")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (sub && ENTITLING_SUB_STATUSES.has(sub.status)) return sub.plan as Plan;
  return "free";
}

export class PlanLimitError extends Error {
  constructor(
    readonly resource: string,
    readonly limit: number,
    readonly plan: Plan,
  ) {
    super(
      `Plan limit reached: the ${plan} plan allows ${limit} ${resource}. Upgrade to add more.`,
    );
    this.name = "PlanLimitError";
  }
}

// assertWithinLimit throws PlanLimitError when current >= limit (limit !== null).
// Call it right before an insert in any gated mutation.
export function assertWithinLimit(
  resource: string,
  current: number,
  limit: number | null,
  plan: Plan,
): void {
  if (limit !== null && current >= limit) {
    throw new PlanLimitError(resource, limit, plan);
  }
}
