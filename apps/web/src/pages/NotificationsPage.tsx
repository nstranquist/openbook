import { api } from "@openbook/shared";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { NotificationItem } from "../components/NotificationItem";

export function NotificationsPage() {
  const { results, status, loadMore } = usePaginatedQuery(
    api.notifications.listPage,
    {},
    { initialNumItems: 20 },
  );
  const unread = useQuery(api.notifications.unreadCount) ?? 0;
  const markAllRead = useMutation(api.notifications.markAllRead);
  const loading = status === "LoadingFirstPage";
  return (
    <section className="ob-page ob-stack" aria-labelledby="notifications-title">
      <header className="ob-page-head">
        <div>
          <h1 id="notifications-title">Notifications</h1>
          <p className="ob-muted ob-small">
            {unread > 0 ? `${unread} unread` : "You are all caught up."}
          </p>
        </div>
        {unread > 0 ? (
          <button className="ob-btn ob-btn--sm" onClick={() => void markAllRead()}>
            Mark all read
          </button>
        ) : null}
      </header>
      <div className="ob-card ob-notification-list" aria-busy={loading}>
        {loading ? (
          <div className="ob-empty">Loading notifications…</div>
        ) : results.length === 0 ? (
          <div className="ob-empty-cta">
            <p className="ob-bold">No notifications yet</p>
            <p className="ob-muted ob-small">
              Friend requests, reactions, and comments will appear here.
            </p>
          </div>
        ) : (
          results.map((notification) => (
            <NotificationItem key={notification._id} notification={notification} />
          ))
        )}
      </div>
      {status === "CanLoadMore" ? (
        <button className="ob-btn" onClick={() => loadMore(20)}>
          Load earlier notifications
        </button>
      ) : null}
      {status === "LoadingMore" ? (
        <div className="ob-empty ob-small" aria-live="polite">Loading more…</div>
      ) : null}
    </section>
  );
}
