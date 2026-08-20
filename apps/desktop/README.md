# Openbook desktop (Tauri)

Native window over `apps/web`. Same Convex API. No second social backend.

```bash
# Dev: web on :5173, then
cd apps/desktop/src-tauri && cargo check
cargo install tauri-cli --locked
# from apps/desktop/src-tauri, after `pnpm --filter web build` or with the Vite dev server:
cargo tauri dev
```

CI does not require Rust. `make desktop` still opens Chrome app-mode.
`make desktop-tauri` runs `cargo check` when cargo is installed.

App Store / code signing is operator-gated (KEP-002).
