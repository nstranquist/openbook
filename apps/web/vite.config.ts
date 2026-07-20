import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Port 5173 is also what the Tauri desktop shell points at in dev, so
// `pnpm dev:desktop` wraps the exact same running web app.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  resolve: { dedupe: ["react", "react-dom"] },
});
