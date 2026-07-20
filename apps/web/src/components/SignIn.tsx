import { useAuth } from "@openbook/shared";
import { type FormEvent, useState } from "react";
import { BrandMark } from "./BrandMark";

// Split landing: brand statement left, auth card right. Sign-up captures the
// display name; it's handed to profiles.ensure right after the first
// authenticated render (see App.tsx EnsureProfile).
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
        <div className="ob-landing-mark">
          <BrandMark size={64} alt="" />
          <h1>openbook</h1>
        </div>
        <p className="ob-landing-tagline">
          Connect with friends in realtime — feed, reactions, and messages on one Convex backend.
        </p>
        <ul className="ob-landing-features" aria-label="Product features">
          <li>
            <span aria-hidden="true">⚡</span> Live feed with public &amp; friends visibility
          </li>
          <li>
            <span aria-hidden="true">🤝</span> Friend graph with mutual suggestions
          </li>
          <li>
            <span aria-hidden="true">💬</span> DMs with unread accounting
          </li>
          <li>
            <span aria-hidden="true">🔒</span> Server-enforced trust boundaries
          </li>
        </ul>
      </div>
      <form
        onSubmit={submit}
        className="ob-card ob-auth-card"
        aria-label={flow === "signIn" ? "Log in" : "Sign up"}
      >
        <h2 className="ob-auth-title">{flow === "signIn" ? "Log in to Openbook" : "Create your account"}</h2>
        {flow === "signUp" && (
          <input
            className="g-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
            aria-label="Full name"
            autoComplete="name"
            disabled={busy}
          />
        )}
        <input
          className="g-input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          type="email"
          aria-label="Email"
          autoComplete="email"
          disabled={busy}
          required
        />
        <input
          className="g-input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          type="password"
          aria-label="Password"
          autoComplete={flow === "signIn" ? "current-password" : "new-password"}
          disabled={busy}
          required
          minLength={8}
        />
        <button
          type="submit"
          className="ob-btn ob-btn--primary ob-auth-submit"
          disabled={busy}
        >
          {busy ? "Working…" : flow === "signIn" ? "Log in" : "Sign up"}
        </button>
        {error && (
          <div className="ob-small ob-auth-error" role="alert">
            {error}
          </div>
        )}
        <hr className="ob-divider" />
        <button
          type="button"
          className="ob-btn ob-auth-switch"
          disabled={busy}
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
