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

function ReactionSummary({ post }: { post: EnrichedPost }) {
  if (post.reactionTotal === 0 && post.commentCount === 0) return null;
  const top = (Object.entries(post.reactionCounts) as [ReactionKind, number][])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  return (
    <div className="ob-post-stats">
      <span>
        {top.map(([kind]) => (
          <span key={kind} style={{ fontSize: 15 }}>{reactionEmoji(kind)}</span>
        ))}
        {post.reactionTotal > 0 && <span style={{ marginLeft: 4 }}>{post.reactionTotal}</span>}
      </span>
      {post.commentCount > 0 && (
        <span>{post.commentCount} comment{post.commentCount === 1 ? "" : "s"}</span>
      )}
    </div>
  );
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
    await addComment({ postId, body: parsed.data.body });
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
                    onClick={() => void removeComment({ id: c._id })}
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
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function armHide() {
    hideTimer.current = setTimeout(() => setPickerOpen(false), 350);
  }
  function disarmHide() {
    if (hideTimer.current) clearTimeout(hideTimer.current);
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
              if (confirm("Delete this post?")) void removePost({ id: post._id });
            }}
          >
            🗑
          </button>
        )}
      </div>
      <p className="ob-post-body">{post.body}</p>
      <ReactionSummary post={post} />
      <hr className="ob-divider" style={{ margin: "4px 0" }} />
      <div className="ob-actions">
        <button
          className={`ob-action${post.myReaction ? " reacted" : ""}`}
          onMouseEnter={() => { disarmHide(); setPickerOpen(true); }}
          onMouseLeave={armHide}
          onClick={() =>
            void toggleReaction({ postId: post._id, kind: post.myReaction ?? "like" })
          }
        >
          {myReactionMeta ? (
            <>
              <span>{myReactionMeta.emoji}</span> {myReactionMeta.label}
            </>
          ) : (
            <>👍 Like</>
          )}
          {pickerOpen && (
            <span
              className="ob-picker"
              onMouseEnter={disarmHide}
              onMouseLeave={armHide}
            >
              {REACTIONS.map((r) => (
                <button
                  key={r.kind}
                  title={r.label}
                  aria-label={r.label}
                  onClick={(e) => {
                    e.stopPropagation();
                    setPickerOpen(false);
                    void toggleReaction({ postId: post._id, kind: r.kind });
                  }}
                >
                  {r.emoji}
                </button>
              ))}
            </span>
          )}
        </button>
        <button className="ob-action" onClick={() => setShowComments((v) => !v)}>
          💬 Comment
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
