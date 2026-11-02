import { useConvexAuth } from "convex/react";
import { createContext, createElement, useContext, type ReactNode } from "react";

export interface OpenbookAuthActions {
  managedExternally: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signInWith: (provider: "github" | "google") => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  confirmPasswordReset: (email: string, code: string, newPassword: string) => Promise<void>;
  changePassword: (email: string, currentPassword: string, newPassword: string) => Promise<void>;
  openAccountManagement: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthActionsContext = createContext<OpenbookAuthActions | null>(null);

export function AuthActionsProvider({
  actions,
  children,
}: {
  actions: OpenbookAuthActions;
  children: ReactNode;
}) {
  return createElement(AuthActionsContext.Provider, { value: actions }, children);
}

export function useSession(): { isAuthenticated: boolean; isLoading: boolean } {
  const { isAuthenticated, isLoading } = useConvexAuth();
  return { isAuthenticated, isLoading };
}

export function useAuth(): OpenbookAuthActions {
  const actions = useContext(AuthActionsContext);
  if (!actions) throw new Error("Openbook authentication provider is missing");
  return actions;
}
