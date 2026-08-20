import {
  api,
  commentInput,
  REACTIONS,
  reactionEmoji,
  type Id,
  type ReactionKind,
} from "@openbook/shared";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { type FormEvent, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Avatar } from "./Avatar";
import { timeAgo } from "../lib/format";
import { runOrToast } from "../lib/run";

// One feed story: header, body, reaction summary, Like/Comment actions with
// the hover reaction picker, and the inline comment thread. Everything
// re-renders reactively when anyone else reacts or comments.

interface EnrichedPost {
  _id: Id<"posts">;
  authorId: string;
  body: string;
  audience: "public" | "friends";
  createdAt: number;
  editedAt?: number | null;
  imageUrl?: string | null;
  videoUrl?: string | null;
  commentCount: number;
  reactionCounts: Record<ReactionKind, number>;
  reactionTotal: number;
  author: { userId: string; displayName: string; avatarHue: number };
  myReaction: ReactionKind | null;
}

function ReactionSummary({
  post,
  onOpenComments,
}: {
  post: EnrichedPost;
  onOpenComments?: () => void;
}) {
  if (post.reactionTotal === 0 && post.commentCount === 0) return null;
  const top = (Object.entries(post.reactionCounts) as [ReactionKind, number][])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  const body = (
    <>
      <span>
        {top.map(([kind]) => (
          <span key={kind} style={{ fontSize: 15 }} aria-hidden="true">
            {reactionEmoji(kind)}
          </span>
        ))}
        {post.reactionTotal > 0 && <span style={{ marginLeft: 4 }}>{post.reactionTotal}</span>}
      </span>
      {post.commentCount > 0 && (
        <span>
          {post.commentCount} comment{post.commentCount === 1 ? "" : "s"}
        </span>
      )}
    </>
  );
  // Clicking the summary opens comments when any exist — common social UX.
  if (onOpenComments && post.commentCount > 0) {
    return (
      <button
        type="button"
        className="ob-post-stats"
        onClick={onOpenComments}
        aria-label={`${post.reactionTotal} reactions, ${post.commentCount} comments. Show comments.`}
      >
        {body}
      </button>
    );
  }
  return <div className="ob-post-stats">{body}</div>;
}

function ReportButton({ postId }: { postId: Id<"posts"> }) {
  const create = useMutation(api.reports.create);
  return (
    <button
      type="button"
      className="ob-action"
      onClick={() => {
        const reason = prompt("Why are you reporting this post?");
        if (!reason?.trim()) return;
        void runOrToast(create({ postId, reason }), "Could not report");
      }}
    >
      Report
    </button>
  );
}

function Comments({ postId }: { postId: Id<"posts"> }) {
  const { results: comments, status, loadMore } = usePaginatedQuery(
    api.comments.list,
    { postId },
    { initialNumItems: 20 },
  );
  const me = useQuery(api.profiles.me);
  const addComment = useMutation(api.comments.add);
  const removeComment = useMutation(api.comments.remove);
  const [draft, setDraft] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = commentInput.safeParse({ body: draft });
    if (!parsed.success) return;
    setDraft("");
    await runOrToast(addComment({ postId, body: parsed.data.body }), "Could not comment");
  }

  return (
    <div className="ob-reveal">
      {comments.map((c) => (
        <div className="ob-comment" key={c._id}>
          <Avatar name={c.author.displayName} hue={c.author.avatarHue} size={32} userId={c.author.userId} />
          <div>
            <div className="ob-bubble">
              <Link to={`/profile/${c.author.userId}`} className="ob-link ob-bold ob-small">
                {c.author.displayName}
              </Link>
              <div>{c.body}</div>
            </div>
            <span className="ob-muted" style={{ fontSize: 12, marginLeft: 12 }}>
              {timeAgo(c.createdAt)}
              {c.isMine && (
                <>
                  {" · "}
                  <button
                    className="ob-btn--danger-ghost"
                    style={{ border: 0, background: "none", cursor: "pointer", fontSize: 12, padding: 0 }}
                    onClick={() => void runOrToast(removeComment({ id: c._id }), "Could not delete comment")}
                  >
                    Delete
                  </button>
                </>
              )}
            </span>
          </div>
        </div>
      ))}
      {status === "CanLoadMore" && (
        <button type="button" className="ob-btn ob-btn--sm" onClick={() => loadMore(20)}>
          Earlier comments
        </button>
      )}
      {me && (
        <form className="ob-comment" onSubmit={submit}>
          <Avatar name={me.displayName} hue={me.avatarHue} size={32} />
          <input
            className="ob-comment-input"
            placeholder="Write a comment… (Enter to send)"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Write a comment"
          />
        </form>
      )}
    </div>
  );
}

export function PostCard({ post, isMine }: { post: EnrichedPost; isMine: boolean }) {
  const toggleReaction = useMutation(api.reactions.toggle);
  const removePost = useMutation(api.posts.remove);
  const [showComments, setShowComments] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(post.body);
  const [editAudience, setEditAudience] = useState(post.audience);
  const updatePost = useMutation(api.posts.update);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerPinned, setPickerPinned] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);
  const suppressClick = useRef(false);

  function armHide() {
    if (pickerPinned) return;
    hideTimer.current = setTimeout(() => setPickerOpen(false), 350);
  }
  function disarmHide() {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }
  function pinPicker() {
    disarmHide();
    longPressFired.current = true;
    setPickerPinned(true);
    setPickerOpen(true);
  }
  function react(kind: ReactionKind) {
    setPickerOpen(false);
    setPickerPinned(false);
    void runOrToast(toggleReaction({ postId: post._id, kind }), "Could not react");
  }

  const myReactionMeta = post.myReaction
    ? REACTIONS.find((r) => r.kind === post.myReaction)
    : null;

  return (
    <article className="ob-card ob-reveal">
      <div className="ob-row">
        <Avatar
          name={post.author.displayName}
          hue={post.author.avatarHue}
          userId={post.author.userId}
        />
        <div className="ob-grow">
          <Link to={`/profile/${post.author.userId}`} className="ob-link ob-bold">
            {post.author.displayName}
          </Link>
          <div className="ob-muted ob-small">
            {timeAgo(post.createdAt)} · {post.audience === "public" ? "🌐" : "👥"}
            {post.editedAt ? " · Edited" : ""}
          </div>
        </div>
        {isMine && (
          <span className="ob-row" style={{ gap: 4 }}>
            <button
              className="ob-iconbtn"
              title="Edit post"
              aria-label="Edit post"
              onClick={() => {
                setEditBody(post.body);
                setEditAudience(post.audience);
                setEditing((v) => !v);
              }}
            >
              ✏️
            </button>
            <button
              className="ob-iconbtn"
              title="Delete post"
              aria-label="Delete post"
              onClick={() => {
                if (confirm("Delete this post?")) {
                  void runOrToast(removePost({ id: post._id }), "Could not delete post");
                }
              }}
            >
              🗑
            </button>
          </span>
        )}
      </div>
      {editing && isMine ? (
        <div className="ob-reveal">
          <textarea
            className="ob-textarea"
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            aria-label="Edit post body"
          />
          <div className="ob-row" style={{ justifyContent: "space-between", marginTop: 8 }}>
            <select
              className="ob-select"
              value={editAudience}
              onChange={(e) => setEditAudience(e.target.value as "public" | "friends")}
              aria-label="Who can see this post"
            >
              <option value="public">🌐 Public</option>
              <option value="friends">👥 Friends</option>
            </select>
            <span className="ob-row" style={{ gap: 8 }}>
              <button className="ob-btn ob-btn--sm" onClick={() => setEditing(false)}>Cancel</button>
              <button
                className="ob-btn ob-btn--primary"
                disabled={!editBody.trim() && !post.imageUrl}
                onClick={() =>
                  void runOrToast(
                    updatePost({ id: post._id, body: editBody, audience: editAudience }),
                    "Could not save",
                  ).then((ok) => {
                    if (ok !== undefined) setEditing(false);
                  })
                }
              >
                Save
              </button>
            </span>
          </div>
        </div>
      ) : (
        <>
          {post.body ? <p className="ob-post-body">{post.body}</p> : null}
          {post.imageUrl ? (
            <img src={post.imageUrl} alt="" className="ob-post-image" />
          ) : null}
          {post.videoUrl ? (
            <video src={post.videoUrl} className="ob-post-image" controls />
          ) : null}
        </>
      )}
      <ReactionSummary
        post={post}
        onOpenComments={() => setShowComments(true)}
      />
      <hr className="ob-divider" style={{ margin: "4px 0" }} />
      <div className="ob-actions">
        <button
          type="button"
          className={`ob-action${post.myReaction ? " reacted" : ""}`}
          onMouseEnter={() => { disarmHide(); setPickerOpen(true); }}
          onMouseLeave={armHide}
          onTouchStart={() => {
            longPressFired.current = false;
            longPress.current = setTimeout(pinPicker, 450);
          }}
          onTouchEnd={() => {
            if (longPress.current) clearTimeout(longPress.current);
            if (longPressFired.current) suppressClick.current = true;
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            pinPicker();
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              pinPicker();
            }
          }}
          onClick={() => {
            if (suppressClick.current) {
              suppressClick.current = false;
              return;
            }
            react(post.myReaction ?? "like");
          }}
          aria-pressed={post.myReaction != null}
          aria-haspopup="true"
          aria-expanded={pickerOpen}
          aria-label={myReactionMeta ? `Reacted: ${myReactionMeta.label}` : "Like. Long-press or ArrowDown for more reactions."}
        >
          {myReactionMeta ? (
            <>
              <span aria-hidden="true">{myReactionMeta.emoji}</span> {myReactionMeta.label}
            </>
          ) : (
            <>
              <span aria-hidden="true">👍</span> Like
            </>
          )}
          {pickerOpen && (
            <span
              className="ob-picker"
              role="toolbar"
              aria-label="Choose reaction"
              onMouseEnter={disarmHide}
              onMouseLeave={armHide}
            >
              {REACTIONS.map((r) => (
                <button
                  key={r.kind}
                  type="button"
                  title={r.label}
                  aria-label={r.label}
                  onClick={(e) => {
                    e.stopPropagation();
                    react(r.kind);
                  }}
                >
                  {r.emoji}
                </button>
              ))}
            </span>
          )}
        </button>
        <button
          type="button"
          className="ob-action"
          onClick={() => setShowComments((v) => !v)}
          aria-expanded={showComments}
        >
          <span aria-hidden="true">💬</span> Comment
        </button>
        {!isMine && (
          <ReportButton postId={post._id} />
        )}
      </div>
      {showComments && (
        <>
          <hr className="ob-divider" style={{ margin: "4px 0 0" }} />
          <Comments postId={post._id} />
        </>
      )}
    </article>
  );
}

export type { EnrichedPost };
