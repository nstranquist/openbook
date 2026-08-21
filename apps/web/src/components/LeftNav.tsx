import { api } from "@openbook/shared";
import { useQuery } from "convex/react";
import { NavLink } from "react-router-dom";
import { Avatar } from "./Avatar";

const LINKS = [
  { to: "/", end: true, label: "Home", icon: "🏠" },
  { to: "/friends", label: "Friends", icon: "👥" },
  { to: "/messages", label: "Messages", icon: "💬" },
  { to: "/groups", label: "Groups", icon: "⬡" },
  { to: "/events", label: "Events", icon: "📅" },
  { to: "/saved", label: "Saved", icon: "🔖" },
  { to: "/notifications", label: "Notifications", icon: "🔔" },
  { to: "/settings", label: "Settings", icon: "⚙️" },
] as const;

export function LeftNav() {
  const me = useQuery(api.profiles.me);
  const msgUnread = useQuery(api.messages.unreadTotal) ?? 0;
  const notifUnread = useQuery(api.notifications.unreadCount) ?? 0;
  if (!me || me.deleted) return <nav className="ob-leftnav" aria-label="Main navigation" />;
  return (
    <nav className="ob-leftnav" aria-label="Main navigation">
      <NavLink to={`/profile/${me.userId}`} className="ob-leftnav-me">
        <Avatar name={me.displayName} hue={me.avatarHue} size={36} />
        <span className="ob-bold">{me.displayName}</span>
      </NavLink>
      {LINKS.map((link) => (
        <NavLink
          key={link.to}
          to={link.to}
          end={"end" in link ? link.end : false}
          className={({ isActive }) => `ob-leftnav-item${isActive ? " active" : ""}`}
        >
          <span className="ob-leftnav-icon" aria-hidden="true">
            {link.icon}
          </span>
          <span className="ob-bold">{link.label}</span>
          {link.to === "/messages" && msgUnread > 0 ? (
            <span className="ob-badge-dot ob-leftnav-badge">{msgUnread > 9 ? "9+" : msgUnread}</span>
          ) : null}
          {link.to === "/notifications" && notifUnread > 0 ? (
            <span className="ob-badge-dot ob-leftnav-badge">{notifUnread > 9 ? "9+" : notifUnread}</span>
          ) : null}
        </NavLink>
      ))}
    </nav>
  );
}
