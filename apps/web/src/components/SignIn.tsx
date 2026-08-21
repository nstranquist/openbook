import { useAuth } from "@openbook/shared";
import { type FormEvent, useRef, useState } from "react";
import { BrandMark } from "./BrandMark";
import { Field } from "./Field";
import { devIdentity, isDevLoginAvailable, useDevAutoLogin } from "../lib/devAutoLogin";
import { clearSavedLogin, loadSavedLogin, saveLogin } from "../lib/savedLogin";

// Split landing: brand statement left, auth card right. Sign-up captures the
// display name; it's handed to profiles.ensure right after the first
// authenticated render (see App.tsx EnsureProfile).
export function SignIn() {
  const { signIn, signUp, signInWith, requestPasswordReset, confirmPasswordReset } = useAuth();
  const saved = useRef(loadSavedLogin()).current;
  const [name, setName] = useState("");
  const [email, setEmail] = useState(saved?.email ?? "");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [remember, setRemember] = useState(saved !== null);
  const [flow, setFlow] = useState<"signIn" | "signUp" | "reset" | "resetVerify">("signIn");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<"form" | "dev" | "oauth" | false>(false);
  const autoLogin = useDevAutoLogin();
  const dev = devIdentity();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy("form");
    try {
      if (flow === "signUp") {
        if (!name.trim()) {
          setError("Please enter your name");
          return;
        }
        sessionStorage.setItem("openbook.signupName", name.trim());
        await signUp(email, password);
      } else if (flow === "reset") {
        await requestPasswordReset(email);
        setFlow("resetVerify");
        setNotice("If that account exists, we sent a reset code.");
        setBusy(false);
        return;
      } else if (flow === "resetVerify") {
        await confirmPasswordReset(email, code, password);
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
        <h2 className="ob-auth-title">
          {flow === "signIn"
            ? "Log in to Openbook"
            : flow === "signUp"
              ? "Create your account"
              : flow === "reset"
                ? "Reset password"
                : "Enter reset code"}
        </h2>
        {flow === "signUp" && (
          <Field label="Full name">
            <input
              className="g-input"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              disabled={busy !== false}
              required
            />
          </Field>
        )}
        <Field label="Email address">
          <input
            className="g-input"
            name="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            autoComplete="email"
            disabled={busy !== false}
            required
          />
        </Field>
        {flow === "resetVerify" && (
          <Field label="Reset code">
            <input
              className="g-input"
              name="code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="one-time-code"
              inputMode="numeric"
              disabled={busy !== false}
              required
            />
          </Field>
        )}
        {flow !== "reset" && (
          <Field
            label={flow === "resetVerify" ? "New password" : "Password"}
            hint={flow === "signIn" ? undefined : "Use at least 8 characters."}
          >
            <input
              className="g-input"
              name="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete={flow === "signIn" ? "current-password" : "new-password"}
              disabled={busy !== false}
              required
              minLength={8}
            />
          </Field>
        )}
        {flow === "signIn" && (
          <button
            type="button"
            className="ob-link ob-small"
            style={{ alignSelf: "flex-start", background: "none", border: 0, padding: 0, cursor: "pointer" }}
            onClick={() => { setFlow("reset"); setError(null); setNotice(null); }}
          >
            Forgot password?
          </button>
        )}
        {(flow === "signIn" || flow === "signUp") && (
          <label className="ob-small ob-check-row">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} disabled={busy !== false} />
            <span>Remember my email on this device</span>
          </label>
        )}
        <button
          type="submit"
          className="ob-btn ob-btn--primary ob-auth-submit"
          disabled={busy !== false}
        >
          {busy === "form"
            ? "Working…"
            : flow === "signIn"
              ? "Log in"
              : flow === "signUp"
                ? "Sign up"
                : flow === "reset"
                  ? "Send reset code"
                  : "Set new password"}
        </button>
        {flow === "signIn" && (
          <div className="ob-row" style={{ gap: 8 }}>
            <button
              type="button"
              className="ob-btn"
              style={{ flex: 1 }}
              disabled={busy !== false}
              onClick={() => {
                setBusy("oauth");
                void signInWith("github").catch((err) => {
                  setBusy(false);
                  setError(err instanceof Error ? err.message : "GitHub sign-in failed");
                });
              }}
            >
              GitHub
            </button>
            <button
              type="button"
              className="ob-btn"
              style={{ flex: 1 }}
              disabled={busy !== false}
              onClick={() => {
                setBusy("oauth");
                void signInWith("google").catch((err) => {
                  setBusy(false);
                  setError(err instanceof Error ? err.message : "Google sign-in failed");
                });
              }}
            >
              Google
            </button>
          </div>
        )}
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
        {notice && <div className="ob-small ob-auth-notice" role="status">{notice}</div>}
        <hr className="ob-divider" />
        <button
          type="button"
          className="ob-btn ob-auth-switch"
          disabled={busy !== false}
          onClick={() => {
            setFlow(flow === "signUp" || flow === "reset" || flow === "resetVerify" ? "signIn" : "signUp");
            setError(null);
            setNotice(null);
          }}
        >
          {flow === "signIn" ? "Create new account" : "Already have an account?"}
        </button>
      </form>
    </div>
  );
}
