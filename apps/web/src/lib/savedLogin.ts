// Local-only email memory. The Convex Auth session is the login; we never
// persist a password in localStorage.

export type SavedLogin = {
  email: string;
};

const KEY = "openbook.savedLogin.v1";

function persistEmail(email: string): void {
  localStorage.setItem(KEY, JSON.stringify({ email }));
}

export function loadSavedLogin(): SavedLogin | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedLogin> & { password?: unknown };
    if (typeof parsed.email !== "string" || !parsed.email.trim()) {
      localStorage.removeItem(KEY);
      return null;
    }
    const email = parsed.email;
    if ("password" in parsed || Object.keys(parsed).some((k) => k !== "email")) {
      persistEmail(email);
    }
    return { email };
  } catch {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    return null;
  }
}

export function saveLogin(login: SavedLogin): void {
  try {
    persistEmail(login.email);
  } catch {
    // Private-mode / quota failures just mean no prefill next run.
  }
}

export function clearSavedLogin(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Same: losing the shortcut is fine.
  }
}
