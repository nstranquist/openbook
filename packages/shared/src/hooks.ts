import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";

// The unified app-layer auth contract. Every lane's @openbook/shared exports
// these exact signatures; only the implementation (here: Convex Auth) differs.
// Social data access goes straight through `api` + convex/react hooks — the
// reactive queries ARE the realtime layer.

export function useSession(): { isAuthenticated: boolean; isLoading: boolean } {
  const { isAuthenticated, isLoading } = useConvexAuth();
  return { isAuthenticated, isLoading };
}

export function useAuth(): {
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
} {
  const { signIn, signOut } = useAuthActions();
  return {
    signIn: async (email, password) => {
      await signIn("password", { email, password, flow: "signIn" });
    },
    signUp: async (email, password) => {
      await signIn("password", { email, password, flow: "signUp" });
    },
    signOut: async () => {
      await signOut();
    },
  };
}
