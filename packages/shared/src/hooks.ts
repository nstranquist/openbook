import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";

// App-layer auth contract for the web client. Implementation is Convex Auth.
// Social data access goes straight through `api` + convex/react hooks — the
// reactive queries ARE the realtime layer.

export function useSession(): { isAuthenticated: boolean; isLoading: boolean } {
  const { isAuthenticated, isLoading } = useConvexAuth();
  return { isAuthenticated, isLoading };
}

export function useAuth(): {
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signInWith: (provider: "github" | "google") => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  confirmPasswordReset: (email: string, code: string, newPassword: string) => Promise<void>;
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
    signInWith: async (provider) => {
      await signIn(provider);
    },
    requestPasswordReset: async (email) => {
      try {
        await signIn("password", { email, flow: "reset" });
      } catch {
        // Same response whether the email exists or mail is unset.
      }
    },
    confirmPasswordReset: async (email, code, newPassword) => {
      await signIn("password", {
        email,
        code,
        newPassword,
        flow: "reset-verification",
      });
    },
    signOut: async () => {
      await signOut();
    },
  };
}
