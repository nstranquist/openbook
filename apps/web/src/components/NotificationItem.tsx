import { api, type Id } from "@openbook/shared";
import { useMutation } from "convex/react";
import { useNavigate } from "react-router-dom";
import { timeAgo } from "../lib/format";
import { Avatar } from "./Avatar";

export interface NotificationItemData {
  _id: Id<"notifications">;
  kind: "friend_request" | "friend_accept" | "reaction" | "comment";
  postId: Id<"posts"> | null;
  read: boolean;
  createdAt: number;
  actor: {
    userId: Id<"users">;
    displayName: string;
    avatarHue: number;
  };
}

const NOTIFICATION_TEXT: Record<NotificationItemData["kind"], string> = {
  friend_request: "sent you a friend request",
  friend_accept: "accepted your friend request",
  reaction: "reacted to your post",
  comment: "commented on your post",
};

export function NotificationItem({
  notification,
  onActivate,
}: {
  notification: NotificationItemData;
  onActivate?: () => void;
}) {
  const markRead = useMutation(api.notifications.markRead);
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className={`ob-menu-item ob-notification-item${notification.read ? "" : " unread"}`}
      onClick={() => {
        if (!notification.read) void markRead({ id: notification._id });
        onActivate?.();
        if (notification.postId) navigate(`/post/${notification.postId}`);
        else if (notification.kind === "friend_request") navigate("/friends");
        else navigate(`/profile/${notification.actor.userId}`);
      }}
    >
      <Avatar
        name={notification.actor.displayName}
        hue={notification.actor.avatarHue}
        size={36}
      />
      <span className="ob-grow">
        <span className="ob-bold">{notification.actor.displayName}</span>{" "}
        {NOTIFICATION_TEXT[notification.kind]}
        <span className="ob-muted ob-small"> · {timeAgo(notification.createdAt)}</span>
      </span>
    </button>
  );
}
