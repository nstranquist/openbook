import { useAuth, useSession } from "@openbook/shared";
import { useEffect, useState } from "react";
import { loadSavedLogin } from "./savedLogin";

type DevAutoLoginState = {
  enabled: boolean;
  busy: boolean;
  email: string | null;
  error: string | null;
};

type DevAutoLoginEnv = ImportMetaEnv & {
  VITE_OPENBOOK_AUTO_LOGIN?: string;
  VITE_OPENBOOK_DEV_LOGIN?: string;
  VITE_OPENBOOK_DEV_EMAIL?: string;
  VITE_OPENBOOK_DEV_PASSWORD?: string;
};

const attempted = new Set<string>();

// Where the throwaway dev identity may exist at all. Vite dev servers always
// qualify; a bundle only qualifies if it was built with VITE_OPENBOOK_DEV_LOGIN=1
// (the desktop `bundle:local` target).
//
// Both operands are written as static `import.meta.env.X` reads against literals
// so Vite substitutes them at build time: in a production bundle this whole
// expression folds to `false` and the dev zone is dropped from the output, not
// merely left unrendered. Keep the `=== "1"` exact — a truthy() call here would
// survive folding and ship the dev markup into production.
const DEV_LOGIN_AVAILABLE =
  import.meta.env.DEV || import.meta.env.VITE_OPENBOOK_DEV_LOGIN === "1";

export function isDevLoginAvailable(): boolean {
  return DEV_LOGIN_AVAILABLE;
}

function truthy(value: string | undefined): boolean {
  return /^(1|true|on|yes)$/i.test(value ?? "");
}

function env(): DevAutoLoginEnv {
  return import.meta.env as DevAutoLoginEnv;
}

// The early return is what keeps the address literals out of shipped bundles:
// with DEV_LOGIN_AVAILABLE folded to false, the rest of this body — and the
// "dev@openbook.local" / "openbook-local-dev" strings with it — is dead code the
// bundler drops. Callers may invoke this unconditionally.
export function devIdentity(): { email: string; password: string } {
  if (!DEV_LOGIN_AVAILABLE) return { email: "", password: "" };
  const e = env();
  return {
    email: e.VITE_OPENBOOK_DEV_EMAIL?.trim() || "dev@openbook.local",
    password: e.VITE_OPENBOOK_DEV_PASSWORD || "openbook-local-dev",
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "auto sign-in failed";
}

export function isDevAutoLoginEnabled(): boolean {
  return isDevLoginAvailable() && truthy(env().VITE_OPENBOOK_AUTO_LOGIN);
}

// Auto sign-in sources, strongest first: a login the user saved with
// "sign me in on launch" (any build), then the env-flag dev identity.
function autoLoginIdentity(): { email: string; password: string; signUpFallback: boolean } | null {
  const saved = loadSavedLogin();
  if (saved?.autoSignIn) {
    return { email: saved.email, password: saved.password, signUpFallback: false };
  }
  if (isDevAutoLoginEnabled()) {
    return { ...devIdentity(), signUpFallback: true };
  }
  return null;
}

// An unreachable backend must not strand the user on the auto-login card: the
// client retries a dead connection rather than rejecting, so without this bound
// `busy` never clears and the sign-in form — and its dev-login button — stays
// unreachable. On timeout we fall through to the form with an actionable error.
const AUTO_LOGIN_TIMEOUT_MS = 8000;

function withAutoLoginTimeout<T>(work: Promise<T>): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("auto sign-in timed out — is the local backend running?")),
        AUTO_LOGIN_TIMEOUT_MS,
      ),
    ),
  ]);
}

export function useDevAutoLogin(): DevAutoLoginState {
  const { isAuthenticated, isLoading } = useSession();
  const { signIn, signUp } = useAuth();
  const [state, setState] = useState<DevAutoLoginState>(() => {
    const identity = autoLoginIdentity();
    return {
      enabled: identity !== null,
      busy: false,
      email: identity?.email ?? null,
      error: null,
    };
  });

  useEffect(() => {
    if (isLoading || isAuthenticated) return;

    const identity = autoLoginIdentity();
    if (!identity) return;

    const key = `${identity.email}:${import.meta.env.VITE_CONVEX_URL ?? ""}`;
    if (attempted.has(key)) return;
    attempted.add(key);

    let cancelled = false;
    setState({ enabled: true, busy: true, email: identity.email, error: null });

    void (async () => {
      try {
        try {
          await withAutoLoginTimeout(signIn(identity.email, identity.password));
        } catch (err) {
          // Only the throwaway dev identity may self-provision; a saved real
          // login failing should surface, not create a lookalike account.
          if (!identity.signUpFallback) throw err;
          await withAutoLoginTimeout(signUp(identity.email, identity.password));
        }
        if (!cancelled) {
          setState({ enabled: true, busy: false, email: identity.email, error: null });
        }
      } catch (err) {
        if (!cancelled) {
          setState({
            enabled: true,
            busy: false,
            email: identity.email,
            error: errorMessage(err),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, isLoading, signIn, signUp]);

  return state;
}
