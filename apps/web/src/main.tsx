// Openbook vendors the generated Nico-owned Garrid CSS snapshot so a clean
// checkout never depends on unpublished packages outside this repository.
import "./ui/garrid.css";
import "./ui/openbook-theme.css";
import "./ui/openbook.css";
import { createConvexClient, resolveConvexUrl } from "@openbook/shared";
import { Toasts, initTheme } from "./ui/garrid";
import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { installClientTelemetry } from "./lib/telemetry";
import { ProductionAuthProvider } from "./lib/authProviders";

const convex = createConvexClient(resolveConvexUrl(import.meta.env));
installClientTelemetry({
  endpoint: import.meta.env.VITE_OPENBOOK_ERROR_REPORT_URL,
  release: import.meta.env.VITE_OPENBOOK_RELEASE,
  environment: import.meta.env.VITE_OPENBOOK_ENV,
});

function Root() {
  useEffect(() => {
    initTheme();
    if ("serviceWorker" in navigator) {
      const release = encodeURIComponent(import.meta.env.VITE_OPENBOOK_RELEASE || "dev");
      void navigator.serviceWorker.register(`/sw.js?release=${release}`);
    }
  }, []);
  return (
    <ProductionAuthProvider client={convex}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
      <Toasts />
    </ProductionAuthProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
