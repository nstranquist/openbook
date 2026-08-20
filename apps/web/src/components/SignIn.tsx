import { useAuth } from "@openbook/shared";
import { type FormEvent, useRef, useState } from "react";
import { BrandMark } from "./BrandMark";
import { devIdentity, isDevLoginAvailable, useDevAutoLogin } from "../lib/devAutoLogin";
import { clearSavedLogin, loadSavedLogin, saveLogin } from "../lib/savedLogin";

// Split landing: brand statement left, auth card right. Sign-up captures the
// display name; it's handed to profiles.ensure right after the first
// authenticated render (see App.tsx EnsureProfile).
export function SignIn() {
  const { signIn, signUp } = useAuth();
  const saved = useRef(loadSavedLogin()).current;
  const [name, setName] = useState("");
  const [email, setEmail] = useState(saved?.email ?? "");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(saved !== null);
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"form" | "dev" | false>(false);
  const autoLogin = useDevAutoLogin();
  const dev = devIdentity();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy("form");
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
      if (remember) saveLogin({ email });
      else clearSavedLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  async function devLogin() {
    setError(null);
    setBusy("dev");
    try {
      // The throwaway identity needs a display name too, or EnsureProfile has
      // nothing to hand profiles.ensure on first provision.
      sessionStorage.setItem("openbook.signupName", "Dev User");
      try {
        await signIn(dev.email, dev.password);
      } catch {
        await signUp(dev.email, dev.password);
      }
      // Persist the throwaway identity too, when asked — otherwise the one-click
      // path can never be remembered across launches.
      if (remember) saveLogin({ email: dev.email });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dev sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  if (autoLogin.busy) {
    return (
      <div className="ob-landing">
        <p role="status">
          Signing in as <strong>{autoLogin.email}</strong>…
        </p>
      </div>
    );
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
            disabled={busy !== false}
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
          disabled={busy !== false}
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
          disabled={busy !== false}
          required
          minLength={8}
        />
        <label className="ob-small" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} disabled={busy !== false} />
          <span>Remember my email on this device</span>
        </label>
        <button
          type="submit"
          className="ob-btn ob-btn--primary ob-auth-submit"
          disabled={busy !== false}
        >
          {busy === "form" ? "Working…" : flow === "signIn" ? "Log in" : "Sign up"}
        </button>
        {isDevLoginAvailable() && (
          <button
            type="button"
            className="ob-btn"
            disabled={busy !== false}
            onClick={() => void devLogin()}
          >
            {busy === "dev" ? "Working…" : `⚡ Dev login — ${dev.email}`}
          </button>
        )}
        {(error ?? autoLogin.error) && (
          <div className="ob-small ob-auth-error" role="alert">
            {error ?? autoLogin.error}
          </div>
        )}
        <hr className="ob-divider" />
        <button
          type="button"
          className="ob-btn ob-auth-switch"
          disabled={busy !== false}
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
