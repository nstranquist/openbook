import { api, useSession } from "@openbook/shared";
import { useConvexAuth, useMutation } from "convex/react";
import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { SignIn } from "./components/SignIn";
import { TopNav } from "./components/TopNav";
import { FeedPage } from "./pages/FeedPage";
import { FriendsPage } from "./pages/FriendsPage";
import { MessagesPage } from "./pages/MessagesPage";
import { ProfilePage } from "./pages/ProfilePage";
import { SettingsPage } from "./pages/SettingsPage";

// Every authenticated session ensures its profile row exists before the social
// surface renders — profiles.ensure is idempotent, so this is a cheap no-op
// after the first boot.
function EnsureProfile({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useConvexAuth();
  const ensure = useMutation(api.profiles.ensure);
  useEffect(() => {
    if (isAuthenticated) {
      const pendingName = sessionStorage.getItem("openbook.signupName");
      void ensure(pendingName ? { displayName: pendingName } : {}).then(() =>
        sessionStorage.removeItem("openbook.signupName"),
      );
    }
  }, [isAuthenticated, ensure]);
  return <>{children}</>;
}

export function App() {
  const { isAuthenticated, isLoading } = useSession();

  if (isLoading) {
    return (
      <div className="ob-landing" aria-busy="true" aria-live="polite">
        <div className="ob-landing-brand ob-landing-loading">
          <img src="/openbook.svg" width={56} height={56} alt="" className="ob-brand-mark" />
          <h1>openbook</h1>
          <p className="ob-muted">Loading…</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) return <SignIn />;

  return (
    <EnsureProfile>
      <div className="ob-shell">
        <TopNav />
        <Routes>
          <Route path="/" element={<FeedPage />} />
          <Route path="/friends" element={<FriendsPage />} />
          <Route path="/messages" element={<MessagesPage />} />
          <Route path="/messages/:conversationId" element={<MessagesPage />} />
          <Route path="/profile/:userId" element={<ProfilePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </EnsureProfile>
  );
}
