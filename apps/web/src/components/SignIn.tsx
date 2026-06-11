import { useAuth } from "@openbook/shared";
import { type FormEvent, useState } from "react";

// The classic split landing: brand statement left, auth card right. Sign-up
// captures the display name; it's handed to profiles.ensure right after the
// first authenticated render (see App.tsx EnsureProfile).
export function SignIn() {
  const { signIn, signUp } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (flow === "signUp") {
        if (!name.trim()) {
          setError("Please enter your name");
          return;
        }
        sessionStorage.setItem("openbook.signupName", name.trim());
        await signUp(email, password);
      } else {
        await signIn(email, password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ob-landing">
      <div className="ob-landing-brand">
        <h1>openbook</h1>
        <p>Connect with friends and the world around you on Openbook.</p>
        <p className="ob-muted" style={{ fontSize: 15, marginTop: 12 }}>
          Realtime feed, reactions, friends and messages — synced live on Convex.
        </p>
      </div>
      <form onSubmit={submit} className="ob-card" style={{ width: 360, display: "flex", flexDirection: "column", gap: 12, padding: 20 }}>
        {flow === "signUp" && (
          <input
            className="g-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
            aria-label="Full name"
          />
        )}
        <input
          className="g-input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          type="email"
          aria-label="Email"
        />
        <input
          className="g-input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          type="password"
          aria-label="Password"
        />
        <button type="submit" className="ob-btn ob-btn--primary" disabled={busy} style={{ fontSize: 17, padding: "11px 0" }}>
          {flow === "signIn" ? "Log in" : "Sign up"}
        </button>
        {error && <div className="ob-small" style={{ color: "var(--danger)", textAlign: "center" }}>{error}</div>}
        <hr className="ob-divider" />
        <button
          type="button"
          className="ob-btn"
          style={{ background: "var(--success)", color: "white", alignSelf: "center", padding: "11px 16px" }}
          onClick={() => {
            setFlow(flow === "signIn" ? "signUp" : "signIn");
            setError(null);
          }}
        >
          {flow === "signIn" ? "Create new account" : "Already have an account?"}
        </button>
      </form>
    </div>
  );
}
