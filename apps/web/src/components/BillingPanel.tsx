import { api } from "@openbook/shared";
import { useAction, useQuery } from "convex/react";
import { useState } from "react";

// Plan + usage, with Stripe TEST checkout when keys are configured on the
// deployment. Rendered from Settings so the free-tier post cap is visible.
export function BillingPanel() {
  const plan = useQuery(api.billing.getMyPlan, {});
  const createCheckout = useAction(api.billing.createCheckout);
  const createPortal = useAction(api.billing.createPortal);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (plan === undefined) return null;
  const current = plan?.plan ?? "free";
  const isPaid = current === "pro";
  const postLimit = plan?.limits.posts;
  const usage = plan?.usage.posts ?? 0;

  async function go(fn: () => Promise<{ url: string }>) {
    setError(null);
    setBusy(true);
    try {
      const { url } = await fn();
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="g-card" style={{ marginTop: "var(--space-5)" }}>
      <div className="g-card-head">
        <div className="g-card-title">Plan</div>
        <strong style={{ textTransform: "capitalize" }}>{current}</strong>
      </div>
      <p className="g-hint">
        Posts: {usage} / {postLimit ?? "unlimited"}
        {plan?.status && current !== "free" ? ` · ${plan.status}` : ""}
      </p>
      <div className="g-row" style={{ justifyContent: "flex-end", marginTop: "var(--space-3)" }}>
        {!isPaid ? (
          <button
            type="button"
            className="g-btn g-btn--primary"
            disabled={busy}
            onClick={() =>
              void go(() =>
                createCheckout({
                  successUrl: `${window.location.origin}/settings?billing=success`,
                  cancelUrl: `${window.location.origin}/settings?billing=cancelled`,
                }),
              )
            }
          >
            {busy ? "Working…" : "Upgrade to Pro"}
          </button>
        ) : (
          <button
            type="button"
            className="g-btn"
            disabled={busy || !plan?.hasStripeCustomer}
            onClick={() => void go(() => createPortal({ returnUrl: `${window.location.origin}/settings` }))}
          >
            Manage billing
          </button>
        )}
      </div>
      {error && (
        <p className="ob-small" style={{ color: "var(--danger)", marginTop: "var(--space-3)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
