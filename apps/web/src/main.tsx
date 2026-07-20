// Openbook vendors the generated Nico-owned Garrid CSS snapshot so a clean
// checkout never depends on unpublished packages outside this repository.
import "./ui/garrid.css";
import "./ui/openbook-theme.css";
import "./ui/openbook.css";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { createConvexClient, resolveConvexUrl } from "@openbook/shared";
import { Toasts, initTheme } from "./ui/garrid";
import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";

const convex = createConvexClient(resolveConvexUrl(import.meta.env));

function Root() {
  useEffect(() => {
    initTheme();
  }, []);
  return (
    <ConvexAuthProvider client={convex}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
      <Toasts />
    </ConvexAuthProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
