import { api, useAuth, useSession } from "@openbook/shared";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { SignIn } from "./components/SignIn";
import { TopNav } from "./components/TopNav";
import { LeftNav } from "./components/LeftNav";
import { FeedPage } from "./pages/FeedPage";
import { FriendsPage } from "./pages/FriendsPage";
import { MessagesPage } from "./pages/MessagesPage";
import { PostPage } from "./pages/PostPage";
import { ProfilePage } from "./pages/ProfilePage";
import { SettingsPage } from "./pages/SettingsPage";
import { GroupsPage } from "./pages/GroupsPage";
import { EventsPage } from "./pages/EventsPage";
import { StatusPage } from "./pages/StatusPage";
import { SavedPage } from "./pages/SavedPage";
import { NotificationsPage } from "./pages/NotificationsPage";

function ClosedAccount() {
  const { signOut } = useAuth();
  return (
    <main id="main-content" className="ob-landing" tabIndex={-1}>
      <div className="ob-card ob-empty-cta" style={{ maxWidth: 420 }}>
        <p className="ob-bold" style={{ fontSize: 17 }}>This account is closed</p>
        <p className="ob-muted ob-small">Sign out to create a new one.</p>
        <button className="ob-btn ob-btn--primary" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </main>
  );
}

function EnsureProfile({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useConvexAuth();
  const me = useQuery(api.profiles.me);
  const ensure = useMutation(api.profiles.ensure);
  const heartbeat = useMutation(api.profiles.heartbeat);
  useEffect(() => {
    if (!isAuthenticated || me === undefined || me?.deleted) return;
    const pendingName = sessionStorage.getItem("openbook.signupName");
    void ensure(pendingName ? { displayName: pendingName } : {}).then(() =>
      sessionStorage.removeItem("openbook.signupName"),
    );
  }, [isAuthenticated, me, ensure]);
  useEffect(() => {
    if (!isAuthenticated || me?.deleted) return;
    void heartbeat({});
    const id = setInterval(() => void heartbeat({}), 30_000);
    return () => clearInterval(id);
  }, [isAuthenticated, me?.deleted, heartbeat]);
  if (me?.deleted) return <ClosedAccount />;
  return <>{children}</>;
}

function RouteFocus() {
  const { pathname } = useLocation();
  useEffect(() => {
    document.querySelector<HTMLElement>("#main-content")?.focus();
  }, [pathname]);
  return null;
}

export function App() {
  const { isAuthenticated, isLoading } = useSession();

  if (isLoading) {
    return (
      <main id="main-content" className="ob-landing" aria-busy="true" aria-live="polite">
        <div className="ob-landing-brand ob-landing-loading">
          <img src="/openbook.svg" width={56} height={56} alt="" className="ob-brand-mark" />
          <h1>openbook</h1>
          <p className="ob-muted">Loading…</p>
        </div>
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main id="main-content" tabIndex={-1}>
        <Routes>
          <Route path="/status" element={<StatusPage />} />
          <Route path="*" element={<SignIn />} />
        </Routes>
      </main>
    );
  }

  return (
    <EnsureProfile>
      <div className="ob-shell">
        <a className="ob-skip-link" href="#main-content">Skip to content</a>
        <TopNav />
        <div className="ob-body">
          <LeftNav />
          <main id="main-content" className="ob-main" tabIndex={-1}>
            <RouteFocus />
            <Routes>
              <Route path="/" element={<FeedPage />} />
              <Route path="/friends" element={<FriendsPage />} />
              <Route path="/messages" element={<MessagesPage />} />
              <Route path="/messages/:conversationId" element={<MessagesPage />} />
              <Route path="/profile/:userId" element={<ProfilePage />} />
              <Route path="/post/:postId" element={<PostPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/groups" element={<GroupsPage />} />
              <Route path="/groups/:groupId" element={<GroupsPage />} />
              <Route path="/events" element={<EventsPage />} />
              <Route path="/saved" element={<SavedPage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/status" element={<StatusPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </div>
    </EnsureProfile>
  );
}
