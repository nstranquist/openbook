import { useSyncExternalStore } from "react";

type ThemeMode = "light" | "dark";
type ToastKind = "ok" | "warn" | "err" | "info";
type ToastItem = { id: number; message: string; kind: ToastKind };

let theme: ThemeMode = "dark";
const themeListeners = new Set<() => void>();

function emitTheme() {
  themeListeners.forEach((listener) => listener());
}

function subscribeTheme(listener: () => void) {
  themeListeners.add(listener);
  return () => {
    themeListeners.delete(listener);
  };
}

export function initTheme() {
  const saved = localStorage.getItem("openbook-theme") as ThemeMode | null;
  theme = saved ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.dataset.theme = theme;
  emitTheme();
}

function toggleTheme() {
  theme = theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("openbook-theme", theme);
  emitTheme();
}

function useTheme() {
  return useSyncExternalStore(subscribeTheme, () => theme, () => "dark" as ThemeMode);
}

export function ThemeToggle() {
  const current = useTheme();
  const isDark = current === "dark";
  return (
    <button
      type="button"
      className="g-btn g-btn--ghost g-btn--icon"
      onClick={toggleTheme}
      data-tip={isDark ? "Light mode" : "Dark mode"}
      aria-label="Toggle theme"
    >
      {isDark ? "☀" : "☾"}
    </button>
  );
}

let toasts: ToastItem[] = [];
let nextToastID = 1;
const toastListeners = new Set<() => void>();

function emitToasts() {
  toastListeners.forEach((listener) => listener());
}

function dismiss(id: number) {
  toasts = toasts.filter((item) => item.id !== id);
  emitToasts();
}

export function toast(message: string, kind: ToastKind = "ok", timeoutMS = 3800) {
  const id = nextToastID++;
  toasts = [...toasts, { id, message, kind }];
  emitToasts();
  window.setTimeout(() => dismiss(id), timeoutMS);
  return id;
}

function subscribeToasts(listener: () => void) {
  toastListeners.add(listener);
  return () => {
    toastListeners.delete(listener);
  };
}

export function Toasts() {
  const items = useSyncExternalStore(subscribeToasts, () => toasts, () => [] as ToastItem[]);
  if (items.length === 0) return null;
  return (
    <div className="g-toasts">
      {items.map((item) => (
        <div key={item.id} className="g-toast" role="status">
          <span className={`g-pip g-pip--${item.kind === "info" ? "idle" : item.kind}`} />
          <span style={{ flex: 1 }}>{item.message}</span>
          <button
            type="button"
            className="g-btn g-btn--ghost g-btn--sm g-btn--icon"
            onClick={() => dismiss(item.id)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
