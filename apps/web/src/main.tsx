// Garrid Design System tokens + the Openbook application shell styles.
import "./ui/garrid.css";
import "./ui/openbook.css";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { createConvexClient, resolveConvexUrl } from "@openbook/shared";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";

const convex = createConvexClient(resolveConvexUrl(import.meta.env));

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConvexAuthProvider client={convex}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ConvexAuthProvider>
  </React.StrictMode>,
);
