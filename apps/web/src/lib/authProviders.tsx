import { lazy, Suspense, type ReactNode } from "react";
import type { ConvexReactClient } from "convex/react";

const ClerkAuthProvider = lazy(async () => {
  const module = await import("./clerkAuthProvider");
  return { default: module.ClerkAuthProvider };
});
const LocalAuthProvider = lazy(async () => {
  const module = await import("./localAuthProvider");
  return { default: module.LocalAuthProvider };
});

export function usesClerk(): boolean {
  return import.meta.env.VITE_OPENBOOK_AUTH_MODE === "clerk";
}

export function ProductionAuthProvider({
  client,
  children,
}: {
  client: ConvexReactClient;
  children: ReactNode;
}) {
  const Provider = usesClerk() ? ClerkAuthProvider : LocalAuthProvider;
  return (
    <Suspense fallback={<main className="ob-landing" aria-busy="true">Loading sign-in…</main>}>
      <Provider client={client}>{children}</Provider>
    </Suspense>
  );
}
