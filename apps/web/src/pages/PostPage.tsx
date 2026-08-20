import { api, type Id } from "@openbook/shared";
import { useQuery } from "convex/react";
import { Link, useParams } from "react-router-dom";
import { PostCard, type EnrichedPost } from "../components/PostCard";

export function PostPage() {
  const { postId } = useParams<{ postId: string }>();
  const id = postId as Id<"posts"> | undefined;
  const me = useQuery(api.profiles.me);
  const post = useQuery(api.posts.get, id ? { id } : "skip");

  if (post === undefined) {
    return <div className="ob-empty">Loading post…</div>;
  }
  if (post === null) {
    return (
      <div className="ob-card ob-empty-cta" style={{ margin: "24px auto", maxWidth: 560 }}>
        <p className="ob-bold" style={{ fontSize: 17 }}>
          This post is unavailable
        </p>
        <p className="ob-muted ob-small">
          It may have been deleted, or it is only visible to the author's friends.
        </p>
        <Link to="/" className="ob-btn">
          Back to feed
        </Link>
      </div>
    );
  }

  return (
    <div className="ob-grid" style={{ gridTemplateColumns: "minmax(0, 680px)", margin: "16px auto" }}>
      <div className="ob-stack">
        <Link to="/" className="ob-muted ob-small">
          ← Feed
        </Link>
        <PostCard
          post={post as EnrichedPost}
          isMine={post.author.userId === me?.userId}
        />
      </div>
    </div>
  );
}
