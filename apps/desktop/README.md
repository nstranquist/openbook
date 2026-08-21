# Openbook desktop (Tauri)

Native window over `apps/web`. Same Convex API. No second social backend.

```bash
# Web client first (default :5173). Then:
make desktop-tauri
# Override if Vite is on another port:
# OPENBOOK_WEB_URL=http://localhost:5174 make desktop-tauri
```

`make desktop-tauri` runs `cargo check`, installs `apps/desktop` npm deps if needed, then `npx tauri dev` over `OPENBOOK_WEB_URL` (default `http://localhost:5173`).

CI does not require Rust. `make desktop` still opens Chrome app-mode when you want a window without the Tauri CLI.

App Store / code signing is operator-gated (KEP-002).
