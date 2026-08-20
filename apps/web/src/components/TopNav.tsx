import { api, useAuth } from "@openbook/shared";
import { useQuery, useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { ThemeToggle } from "../ui/garrid";
import { Avatar } from "./Avatar";
import { BrandMark } from "./BrandMark";
import { timeAgo } from "../lib/format";

// The fixed top bar: brand, live people search, section tabs with realtime
// unread badges, the notifications bell, and the account menu. All badges are
// reactive queries — they update the instant another user acts.

function useClickOutside(onAway: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onAway();
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [onAway]);
  return ref;
}

function SearchBox() {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(handle);
  }, [q]);
  const results = useQuery(api.profiles.search, debounced ? { q: debounced } : "skip");
  const ref = useClickOutside(() => setOpen(false));
  const navigate = useNavigate();
  return (
    <div className="ob-search" ref={ref}>
      <input
        placeholder="Search Openbook"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        aria-label="Search Openbook"
      />
      {open && q.trim() && (
        <div className="ob-menu">
          {results === undefined ? (
            <div className="ob-empty ob-small">Searching…</div>
          ) : results.length === 0 ? (
            <div className="ob-empty ob-small">No people found for “{q}”</div>
          ) : (
            results.map((p) => (
              <button
                key={p.userId}
                className="ob-menu-item"
                onClick={() => {
                  setOpen(false);
                  setQ("");
                  navigate(`/profile/${p.userId}`);
                }}
              >
                <Avatar name={p.displayName} hue={p.avatarHue} size={36} />
                <span className="ob-grow">
                  <span className="ob-bold">{p.displayName}</span>
                  {p.isMe ? (
                    <span className="ob-muted ob-small"> · you</span>
                  ) : p.isFriend ? (
                    <span className="ob-muted ob-small"> · friend</span>
                  ) : null}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

const NOTIF_TEXT: Record<string, string> = {
  friend_request: "sent you a friend request",
  friend_accept: "accepted your friend request",
  reaction: "reacted to your post",
  comment: "commented on your post",
};

function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const unread = useQuery(api.notifications.unreadCount) ?? 0;
  const items = useQuery(api.notifications.list, open ? {} : "skip");
  const markAllRead = useMutation(api.notifications.markAllRead);
  const markRead = useMutation(api.notifications.markRead);
  const ref = useClickOutside(() => setOpen(false));
  const navigate = useNavigate();
  return (
    <div style={{ position: "relative" }} ref={ref}>
      <button
        className="ob-iconbtn"
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
        onClick={() => setOpen((v) => !v)}
      >
        🔔
        {unread > 0 && <span className="ob-badge-dot">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="ob-menu">
          <div className="ob-menu-head">
            <span>Notifications</span>
            {unread > 0 && (
              <button className="ob-btn ob-btn--sm" onClick={() => markAllRead()}>
                Mark all read
              </button>
            )}
          </div>
          {items === undefined ? (
            <div className="ob-empty ob-small">Loading…</div>
          ) : items.length === 0 ? (
            <div className="ob-empty ob-small">No notifications yet.</div>
          ) : (
            items.map((n) => (
              <button
                key={n._id}
                className={`ob-menu-item${n.read ? "" : " unread"}`}
                onClick={() => {
                  void markRead({ id: n._id });
                  setOpen(false);
                  if (n.postId) navigate(`/post/${n.postId}`);
                  else if (n.kind === "friend_request") navigate("/friends");
                  else navigate(`/profile/${n.actor.userId}`);
                }}
              >
                <Avatar name={n.actor.displayName} hue={n.actor.avatarHue} size={36} />
                <span className="ob-grow">
                  <span className="ob-bold">{n.actor.displayName}</span>{" "}
                  {NOTIF_TEXT[n.kind] ?? n.kind}
                  <span className="ob-muted ob-small"> · {timeAgo(n.createdAt)}</span>
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function AccountMenu() {
  const me = useQuery(api.profiles.me);
  const { signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(() => setOpen(false));
  const navigate = useNavigate();
  if (!me) return null;
  return (
    <div style={{ position: "relative" }} ref={ref}>
      <button
        className="ob-iconbtn"
        style={{ background: "none" }}
        onClick={() => setOpen((v) => !v)}
        aria-label="Account menu"
      >
        <Avatar name={me.displayName} hue={me.avatarHue} size={40} />
      </button>
      {open && (
        <div className="ob-menu" style={{ minWidth: 240 }}>
          <button
            className="ob-menu-item"
            onClick={() => {
              setOpen(false);
              navigate(`/profile/${me.userId}`);
            }}
          >
            <Avatar name={me.displayName} hue={me.avatarHue} size={36} />
            <span className="ob-bold">{me.displayName}</span>
          </button>
          <button
            className="ob-menu-item"
            onClick={() => {
              setOpen(false);
              navigate("/settings");
            }}
          >
            <span className="ob-iconbtn" style={{ width: 36, height: 36 }}>⚙️</span>
            <span className="ob-bold">Settings</span>
          </button>
          <hr className="ob-divider" />
          <button className="ob-menu-item" onClick={() => void signOut()}>
            <span className="ob-iconbtn" style={{ width: 36, height: 36 }}>⏻</span>
            <span className="ob-bold">Log out</span>
          </button>
        </div>
      )}
    </div>
  );
}

export function TopNav() {
  const msgUnread = useQuery(api.messages.unreadTotal) ?? 0;
  return (
    <header className="ob-nav">
      <div className="ob-nav-left">
        <Link to="/" className="ob-logo" aria-label="Openbook home">
          <BrandMark size={40} alt="" />
        </Link>
        <SearchBox />
      </div>
      <nav className="ob-nav-center" aria-label="Primary">
        <NavLink
          to="/"
          end
          className={({ isActive }) => `ob-tab${isActive ? " active" : ""}`}
          title="Home"
          aria-label="Home"
        >
          🏠
        </NavLink>
        <NavLink
          to="/friends"
          className={({ isActive }) => `ob-tab${isActive ? " active" : ""}`}
          title="Friends"
          aria-label="Friends"
        >
          👥
        </NavLink>
        <NavLink
          to="/messages"
          className={({ isActive }) => `ob-tab${isActive ? " active" : ""}`}
          title="Messages"
          aria-label={msgUnread > 0 ? `Messages (${msgUnread} unread)` : "Messages"}
        >
          💬
          {msgUnread > 0 && (
            <span className="ob-badge-dot" aria-hidden="true">
              {msgUnread > 9 ? "9+" : msgUnread}
            </span>
          )}
        </NavLink>
      </nav>
      <div className="ob-nav-right">
        <ThemeToggle />
        <NotificationsBell />
        <AccountMenu />
      </div>
    </header>
  );
}
