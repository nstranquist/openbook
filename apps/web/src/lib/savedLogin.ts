// Local-only email memory. The Convex Auth session is the login; we never
// persist a password in localStorage.

export type SavedLogin = {
  email: string;
};

const KEY = "openbook.savedLogin.v1";

export function loadSavedLogin(): SavedLogin | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedLogin> & { password?: unknown };
    if (typeof parsed.email !== "string" || !parsed.email.trim()) {
      return null;
    }
    return { email: parsed.email };
  } catch {
    return null;
  }
}

export function saveLogin(login: SavedLogin): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ email: login.email }));
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
