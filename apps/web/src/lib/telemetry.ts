export type ClientErrorKind = "error" | "unhandledrejection";

export interface ClientTelemetryConfig {
  endpoint?: string;
  release?: string;
  environment?: string;
}

const recentReports = new Map<string, number>();
const DEDUPE_MS = 60_000;

export function sanitizeErrorText(value: unknown, maximum = 500): string {
  return String(value ?? "Unknown client error")
    .replace(/\bBearer\s+[^\s]+/gi, "Bearer [redacted]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/https?:\/\/[^\s)\]}]+/gi, "[url]")
    .replace(/\/Users\/[^/\s]+/g, "/Users/[user]")
    .replace(/C:\\Users\\[^\\\s]+/gi, "C:\\Users\\[user]")
    .replace(/\b[A-Za-z0-9_-]{48,}\b/g, "[token]")
    .slice(0, maximum);
}

export async function errorFingerprint(
  kind: ClientErrorKind,
  message: string,
  stack?: string,
): Promise<string> {
  const input = `${kind}\n${message}\n${stack?.split("\n", 1)[0] ?? ""}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

async function report(
  config: Required<ClientTelemetryConfig>,
  kind: ClientErrorKind,
  rawMessage: unknown,
  rawStack?: unknown,
): Promise<void> {
  const message = sanitizeErrorText(rawMessage, 500);
  const stack = rawStack === undefined ? undefined : sanitizeErrorText(rawStack, 2_000);
  const fingerprint = await errorFingerprint(kind, message, stack);
  const now = Date.now();
  if (now - (recentReports.get(fingerprint) ?? 0) < DEDUPE_MS) return;
  recentReports.set(fingerprint, now);
  for (const [key, reportedAt] of recentReports) {
    if (now - reportedAt > DEDUPE_MS) recentReports.delete(key);
  }
  await fetch(config.endpoint, {
    method: "POST",
    mode: "cors",
    credentials: "omit",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fingerprint,
      kind,
      message,
      stack,
      route: location.pathname.slice(0, 500),
      release: config.release.slice(0, 128),
      environment: config.environment.slice(0, 32),
    }),
  }).then(() => undefined, () => undefined);
}

export function installClientTelemetry(config: ClientTelemetryConfig): () => void {
  const endpoint = config.endpoint?.trim() ?? "";
  if (!endpoint) return () => undefined;
  const resolved: Required<ClientTelemetryConfig> = {
    endpoint,
    release: config.release?.trim() || "unknown",
    environment: config.environment?.trim() || "unknown",
  };
  const onError = (event: ErrorEvent) => {
    void report(resolved, "error", event.message, event.error?.stack);
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    void report(
      resolved,
      "unhandledrejection",
      reason instanceof Error ? reason.message : reason,
      reason instanceof Error ? reason.stack : undefined,
    );
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
