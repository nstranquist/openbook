#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const env = { ...process.env };

function unquote(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadEnvDefaults(file) {
  if (!existsSync(file)) return;
  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (env[key]) continue;
    env[key] = unquote(line.slice(eq + 1));
  }
}

// `--build` emits a bundle instead of running the dev server. `--local` marks
// that bundle as a local-only build, which is what unlocks the throwaway dev
// identity (lib/devAutoLogin.ts) and the loopback Convex default. A plain
// `--build` touches neither, so production bundles stay clean.
const mode = args.has("--build") ? "build" : "dev";
const local = mode === "dev" || args.has("--local");

if (local) {
  loadEnvDefaults(resolve(root, ".env.local.web"));

  if (!env.VITE_CONVEX_URL) {
    env.VITE_CONVEX_URL = "http://127.0.0.1:3210";
  }
  if (!env.VITE_OPENBOOK_DEV_LOGIN) {
    env.VITE_OPENBOOK_DEV_LOGIN = "1";
  }
}
if (args.has("--auto-login") && !env.VITE_OPENBOOK_AUTO_LOGIN) {
  env.VITE_OPENBOOK_AUTO_LOGIN = "1";
}

const child = spawn("pnpm", ["--filter", "web", mode], {
  cwd: root,
  env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
