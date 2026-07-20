import { api, messageInput, type Id } from "@openbook/shared";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Avatar } from "../components/Avatar";
import { timeAgo } from "../lib/format";

// Messenger: conversation list + active thread. Delivery is the reactive
// query re-running on the other side — no socket code anywhere. Opening a
// thread (and any message arriving while it's open) marks it read.

function Thread({ conversationId }: { conversationId: Id<"conversations"> }) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.messages.list,
    { conversationId },
    { initialNumItems: 30 },
  );
  const conversations = useQuery(api.messages.myConversations);
  const send = useMutation(api.messages.send);
  const markRead = useMutation(api.messages.markRead);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const meta = conversations?.find((c) => c.conversationId === conversationId);
  // Newest-first from the server; render oldest-first.
  const ordered = useMemo(() => [...results].reverse(), [results]);

  // Read-receipt: entering the thread, or new unread arriving while open.
  useEffect(() => {
    if (meta && meta.unreadCount > 0) void markRead({ conversationId });
  }, [meta?.unreadCount, conversationId, markRead, meta]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [ordered.length]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = messageInput.safeParse({ body: draft });
    if (!parsed.success) return;
    setDraft("");
    await send({ conversationId, body: parsed.data.body });
  }

  return (
    <div className="ob-msg-thread">
      {meta && (
        <div className="ob-row" style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)" }}>
          <Avatar name={meta.other.displayName} hue={meta.other.avatarHue} size={36} userId={meta.other.userId} />
          <span className="ob-bold">{meta.other.displayName}</span>
        </div>
      )}
      <div className="ob-msg-scroll" ref={scrollRef}>
        {status === "CanLoadMore" && (
          <button className="ob-btn ob-btn--sm" style={{ alignSelf: "center" }} onClick={() => loadMore(30)}>
            Load earlier messages
          </button>
        )}
        {ordered.map((m) => (
          <div key={m._id} className={`ob-msg ${m.isMine ? "mine" : "theirs"}`} title={timeAgo(m.createdAt)}>
            {m.body}
          </div>
        ))}
        {ordered.length === 0 && status !== "LoadingFirstPage" && (
          <div className="ob-empty">Say hi 👋</div>
        )}
      </div>
      <form className="ob-msg-compose" onSubmit={submit}>
        <input
          className="ob-comment-input"
          placeholder="Aa"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Type a message"
        />
        <button className="ob-btn ob-btn--primary" disabled={!draft.trim()} type="submit">
          Send
        </button>
      </form>
    </div>
  );
}

export function MessagesPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const conversations = useQuery(api.messages.myConversations);
  const navigate = useNavigate();

  return (
    <div className="ob-msg-layout ob-reveal">
      <div className={`ob-msg-side${conversationId ? " hidden-mobile" : ""}`}>
        <div className="ob-menu-head">Chats</div>
        {(conversations ?? []).length === 0 && (
          <div className="ob-empty ob-small">
            No conversations yet. Open a friend's profile and hit 💬 Message.
          </div>
        )}
        {(conversations ?? []).map((c) => (
          <button
            key={c.conversationId}
            className={`ob-menu-item${c.conversationId === conversationId ? " unread" : ""}`}
            onClick={() => navigate(`/messages/${c.conversationId}`)}
          >
            <Avatar name={c.other.displayName} hue={c.other.avatarHue} size={44} />
            <span className="ob-grow">
              <div className="ob-bold">{c.other.displayName}</div>
              <div className="ob-muted ob-small" style={{ display: "flex", gap: 6 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160, fontWeight: c.unreadCount > 0 ? 700 : 400 }}>
                  {c.lastSenderIsMe ? "You: " : ""}
                  {c.lastMessageBody || "New conversation"}
                </span>
                <span>· {timeAgo(c.lastMessageAt)}</span>
              </div>
            </span>
            {c.unreadCount > 0 && <span className="ob-badge-dot" style={{ position: "static" }}>{c.unreadCount}</span>}
          </button>
        ))}
      </div>
      {conversationId ? (
        <Thread conversationId={conversationId as Id<"conversations">} />
      ) : (
        <div className="ob-msg-thread">
          <div className="ob-empty-cta" style={{ margin: "auto" }}>
            <p className="ob-bold" style={{ fontSize: 17 }}>
              Your messages
            </p>
            <p className="ob-muted ob-small">
              Select a conversation, or open a profile and hit Message to start one.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
