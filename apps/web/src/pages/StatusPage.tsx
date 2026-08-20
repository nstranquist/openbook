export function StatusPage() {
  return (
    <main className="ob-landing">
      <div className="ob-card" style={{ maxWidth: 480 }}>
        <h1 className="ob-bold" style={{ fontSize: 22 }}>Openbook status</h1>
        <p className="ob-muted">
          This is a personal project. There is no SLA, no uptime guarantee, and
          no public hosted userbase claimed by this repository.
        </p>
        <p className="ob-small ob-muted">
          Operators deploy with npx convex deploy, then
          bash scripts/go-live-check.sh. See KEP-003.
        </p>
      </div>
    </main>
  );
}
