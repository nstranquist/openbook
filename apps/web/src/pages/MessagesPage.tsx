import { api, messageInput, type Id } from "@openbook/shared";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Avatar } from "../components/Avatar";
import { timeAgo } from "../lib/format";
import { runOrToast } from "../lib/run";

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
  const navigate = useNavigate();
  const send = useMutation(api.messages.send);
  const removeMessage = useMutation(api.messages.remove);
  const editMessage = useMutation(api.messages.edit);
  const hideThread = useMutation(api.messages.hide);
  const markRead = useMutation(api.messages.markRead);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
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
    await runOrToast(send({ conversationId, body: parsed.data.body }), "Could not send");
  }

  return (
    <div className="ob-msg-thread">
      {meta && (
        <div className="ob-row" style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", justifyContent: "space-between" }}>
          <span className="ob-row" style={{ gap: 8 }}>
            <Avatar name={meta.other.displayName} hue={meta.other.avatarHue} size={36} userId={meta.other.userId} />
            <span className="ob-bold">{meta.other.displayName}</span>
          </span>
          <button
            className="ob-btn ob-btn--sm"
            onClick={() =>
              void runOrToast(hideThread({ conversationId }), "Could not hide").then((ok) => {
                if (ok !== undefined) navigate("/messages");
              })
            }
          >
            Hide
          </button>
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
            {editingId === m._id ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void runOrToast(editMessage({ id: m._id, body: editBody }), "Could not edit").then((ok) => {
                    if (ok !== undefined) setEditingId(null);
                  });
                }}
              >
                <input className="ob-comment-input" value={editBody} onChange={(e) => setEditBody(e.target.value)} />
              </form>
            ) : (
              m.body
            )}
            {m.editedAt ? <span className="ob-muted ob-small"> · edited</span> : null}
            {m.isMine && m.seenByOther ? <span className="ob-muted ob-small"> · seen</span> : null}
            {m.isMine && (
              <>
                <button
                  type="button"
                  className="ob-msg-del"
                  aria-label="Edit message"
                  onClick={() => {
                    setEditingId(m._id);
                    setEditBody(m.body);
                  }}
                >
                  ✎
                </button>
                <button
                  type="button"
                  className="ob-msg-del"
                  aria-label="Delete message"
                  onClick={() => void runOrToast(removeMessage({ id: m._id }), "Could not delete")}
                >
                  ×
                </button>
              </>
            )}
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

function ChatSearch() {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const navigate = useNavigate();
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(handle);
  }, [q]);
  const hits = useQuery(api.messages.search, debounced ? { q: debounced } : "skip");
  if (!hits || hits.length === 0) {
    return (
      <input
        className="g-input"
        placeholder="Search messages"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Search messages"
        style={{ margin: "8px 12px", width: "calc(100% - 24px)" }}
      />
    );
  }
  return (
    <div>
      <input
        className="g-input"
        placeholder="Search messages"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Search messages"
        style={{ margin: "8px 12px", width: "calc(100% - 24px)" }}
      />
      {hits.map((h) => (
        <button
          key={h._id}
          type="button"
          className="ob-menu-item"
          onClick={() => navigate(`/messages/${h.conversationId}`)}
        >
          <span className="ob-small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {h.body}
          </span>
        </button>
      ))}
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
        <ChatSearch />
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
