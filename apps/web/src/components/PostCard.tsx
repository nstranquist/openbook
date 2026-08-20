import {
  api,
  commentInput,
  REACTIONS,
  reactionEmoji,
  type Id,
  type ReactionKind,
} from "@openbook/shared";
import { useMutation, useQuery } from "convex/react";
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

function Comments({ postId }: { postId: Id<"posts"> }) {
  const comments = useQuery(api.comments.list, { postId });
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
      {(comments ?? []).map((c) => (
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
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerPinned, setPickerPinned] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null);

  function armHide() {
    if (pickerPinned) return;
    hideTimer.current = setTimeout(() => setPickerOpen(false), 350);
  }
  function disarmHide() {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }
  function pinPicker() {
    disarmHide();
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
          </div>
        </div>
        {isMine && (
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
        )}
      </div>
      <p className="ob-post-body">{post.body}</p>
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
            longPress.current = setTimeout(pinPicker, 450);
          }}
          onTouchEnd={() => {
            if (longPress.current) clearTimeout(longPress.current);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            pinPicker();
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === " ") {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                pinPicker();
              }
            }
          }}
          onClick={() => react(post.myReaction ?? "like")}
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
