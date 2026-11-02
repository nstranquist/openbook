import { useEffect, useState } from "react";

type Readiness = { ok: boolean; release?: string; environment?: string };

export function StatusPage() {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  useEffect(() => {
    const origin = (import.meta.env.VITE_CONVEX_SITE_URL || "").replace(/\/$/, "");
    if (!origin) {
      setUnreachable(true);
      return;
    }
    const controller = new AbortController();
    void fetch(`${origin}/ready`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as Readiness;
        setReadiness({ ...body, ok: response.ok && body.ok });
      })
      .catch(() => setUnreachable(true));
    return () => controller.abort();
  }, []);
  return (
    <section className="ob-landing" aria-labelledby="status-title">
      <div className="ob-card" style={{ maxWidth: 480 }}>
        <h1 id="status-title" className="ob-bold" style={{ fontSize: 22 }}>Openbook status</h1>
        <p className="ob-muted" role="status">
          {readiness
            ? readiness.ok
              ? "All checked Openbook systems are operational."
              : "Openbook is degraded. Operators have been notified."
            : unreachable
              ? "Live status is unavailable."
              : "Checking live systems…"}
        </p>
        {readiness?.release && (
          <p className="ob-small ob-muted">Release {readiness.release}</p>
        )}
        <p className="ob-small ob-muted">
          The repository does not claim that a public deployment exists. A
          deployed service uses the production SLO and incident runbook.
        </p>
      </div>
    </section>
  );
}
