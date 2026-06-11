import { api } from "@openbook/shared";
import { useAction, useQuery } from "convex/react";
import { useState } from "react";

// BillingPanel — the SaaS kit's billing surface. Shows the signed-in user's plan
// + usage and (Stripe TEST mode) an Upgrade-to-Pro checkout / Manage-billing
// portal. Backed by convex/billing.ts; the webhook syncs the plan back here. When
// the deployment has no Stripe keys, the Upgrade button surfaces the setup error
// instead of charging anyone. Delete this for a non-billable suite.
export function BillingPanel() {
  const plan = useQuery(api.billing.getMyPlan, {});
  const createCheckout = useAction(api.billing.createCheckout);
  const createPortal = useAction(api.billing.createPortal);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (plan === undefined) return null;
  const current = plan?.plan ?? "free";
  const isPaid = current === "pro";

  async function go(fn: () => Promise<{ url: string }>) {
    setError(null);
    setBusy(true);
    try {
      const { url } = await fn();
      window.location.href = url;
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ border: "1px solid #eee", borderRadius: 8, padding: "12px 16px", margin: "12px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>
          Plan: <strong>{current}</strong>
          {plan?.status && current !== "free" ? ` · ${plan.status}` : ""}
        </span>
        {!isPaid ? (
          <button
            disabled={busy}
            onClick={() =>
              void go(() =>
                createCheckout({
                  successUrl: `${window.location.origin}/?billing=success`,
                  cancelUrl: `${window.location.origin}/?billing=cancelled`,
                }),
              )
            }
          >
            Upgrade to Pro
          </button>
        ) : (
          <button
            disabled={busy || !plan?.hasStripeCustomer}
            onClick={() => void go(() => createPortal({ returnUrl: window.location.origin }))}
          >
            Manage billing
          </button>
        )}
      </div>
      {plan?.limits && (
        <p style={{ color: "#666", fontSize: 13, margin: "8px 0 0" }}>
          Posts: {plan.usage.posts} / {plan.limits.posts ?? "∞"} · checkout runs in Stripe (test mode).
        </p>
      )}
      {error && <p style={{ color: "#c00", fontSize: 13, margin: "8px 0 0" }}>{error}</p>}
    </section>
  );
}
