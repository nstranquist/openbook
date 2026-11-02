# Openbook desktop (Tauri)

Native window over `apps/web`. Same Convex API. No second social backend.

```bash
# Web client first (default :5173). Then:
make desktop-tauri
# Override if Vite is on another port:
# OPENBOOK_WEB_URL=http://localhost:5174 make desktop-tauri
```

`make desktop-tauri` runs `cargo check`, installs `apps/desktop` npm deps if needed, then `npx tauri dev` over `OPENBOOK_WEB_URL` (default `http://localhost:5173`). The bundled webview has a Tauri CSP that blocks inline scripts, objects, and unlisted remote script hosts. HTTPS and secure WebSocket connections remain available for the configured Clerk and Convex services.

The full repository gate checks the locked Rust graph and builds an optimized,
unsigned application binary from the production web assets. `make desktop`
still opens Chrome app-mode when you want a window without the Tauri CLI.

For a production package, configure the reviewed production environment and
run `bash scripts/build-desktop.sh` from a clean release checkout. The script
renders the exact Clerk and Convex application, HTTP-action, and WebSocket
origins into a generated Tauri config. It then builds the unsigned application.
The source Tauri config permits only local HTTP and WebSocket origins for local
dogfood.

Signed installers, code signing, and store submission are operator-gated (KEP-002). The repository does not claim that a signed desktop binary exists.
