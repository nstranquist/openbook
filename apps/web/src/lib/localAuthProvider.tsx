import { ConvexAuthProvider, useAuthActions } from "@convex-dev/auth/react";
import {
  AuthActionsProvider,
  type OpenbookAuthActions,
} from "@openbook/shared";
import { useMemo, type ReactNode } from "react";
import type { ConvexReactClient } from "convex/react";

function LocalActions({ children }: { children: ReactNode }) {
  const { signIn, signOut } = useAuthActions();
  const actions = useMemo<OpenbookAuthActions>(() => ({
    managedExternally: false,
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
        // Use the same response when the account does not exist.
      }
    },
    confirmPasswordReset: async (email, code, newPassword) => {
      await signIn("password", { email, code, newPassword, flow: "reset-verification" });
    },
    changePassword: async (email, currentPassword, newPassword) => {
      await signIn("password-change", { email, currentPassword, newPassword });
    },
    openAccountManagement: async () => {},
    signOut: async () => {
      await signOut();
    },
  }), [signIn, signOut]);
  return <AuthActionsProvider actions={actions}>{children}</AuthActionsProvider>;
}

export function LocalAuthProvider({
  client,
  children,
}: {
  client: ConvexReactClient;
  children: ReactNode;
}) {
  return (
    <ConvexAuthProvider client={client}>
      <LocalActions>{children}</LocalActions>
    </ConvexAuthProvider>
  );
}
