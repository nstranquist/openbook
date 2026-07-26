// Local-only login memory. Credentials never leave this device: they live in
// localStorage so the form can prefill (and optionally sign in) on next run.

export type SavedLogin = {
  email: string;
  password: string;
  autoSignIn: boolean;
};

const KEY = "openbook.savedLogin.v1";

export function loadSavedLogin(): SavedLogin | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedLogin>;
    if (typeof parsed.email !== "string" || typeof parsed.password !== "string") {
      return null;
    }
    return {
      email: parsed.email,
      password: parsed.password,
      autoSignIn: parsed.autoSignIn === true,
    };
  } catch {
    return null;
  }
}

export function saveLogin(login: SavedLogin): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(login));
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
