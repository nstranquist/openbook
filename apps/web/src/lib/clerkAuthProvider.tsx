import { ClerkProvider, useAuth as useClerkAuth, useClerk } from "@clerk/react";
import { AuthActionsProvider, type OpenbookAuthActions } from "@openbook/shared";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useMemo, type ReactNode } from "react";
import type { ConvexReactClient } from "convex/react";

function ClerkActions({ children }: { children: ReactNode }) {
  const clerk = useClerk();
  const actions = useMemo<OpenbookAuthActions>(() => {
    const managed = async () => {
      clerk.openUserProfile();
    };
    return {
      managedExternally: true,
      signIn: managed,
      signUp: managed,
      signInWith: managed,
      requestPasswordReset: managed,
      confirmPasswordReset: managed,
      changePassword: managed,
      openAccountManagement: managed,
      signOut: async () => {
        await clerk.signOut({ redirectUrl: "/" });
      },
    };
  }, [clerk]);
  return <AuthActionsProvider actions={actions}>{children}</AuthActionsProvider>;
}

export function ClerkAuthProvider({
  client,
  children,
}: {
  client: ConvexReactClient;
  children: ReactNode;
}) {
  const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
  if (!publishableKey) {
    return <main className="ob-landing" role="alert">Authentication is not configured.</main>;
  }
  return (
    <ClerkProvider publishableKey={publishableKey} afterSignOutUrl="/">
      <ConvexProviderWithClerk client={client} useAuth={useClerkAuth}>
        <ClerkActions>{children}</ClerkActions>
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}
