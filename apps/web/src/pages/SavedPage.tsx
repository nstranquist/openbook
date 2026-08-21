import { api } from "@openbook/shared";
import { usePaginatedQuery, useQuery } from "convex/react";
import { PostCard, type EnrichedPost } from "../components/PostCard";

export function SavedPage() {
  const me = useQuery(api.profiles.me);
  const { results, status, loadMore } = usePaginatedQuery(
    api.saved.list,
    {},
    { initialNumItems: 10 },
  );
  const loading = status === "LoadingFirstPage";
  return (
    <section className="ob-page ob-stack" aria-labelledby="saved-title">
      <header className="ob-page-head">
        <div>
          <h1 id="saved-title">Saved posts</h1>
          <p className="ob-muted ob-small">Only you can see this list.</p>
        </div>
      </header>
      {loading ? (
        <div className="ob-card ob-empty" aria-busy="true">Loading saved posts…</div>
      ) : results.length === 0 ? (
        <div className="ob-card ob-empty-cta">
          <p className="ob-bold">Save posts for later</p>
          <p className="ob-muted ob-small">
            Select Save on a post. It will appear here while you can still view it.
          </p>
        </div>
      ) : (
        results.map((post) => (
          <PostCard
            key={post._id}
            post={post as EnrichedPost}
            isMine={post.author.userId === me?.userId}
          />
        ))
      )}
      {status === "CanLoadMore" ? (
        <button className="ob-btn" onClick={() => loadMore(10)}>Load more</button>
      ) : null}
      {status === "LoadingMore" ? (
        <div className="ob-empty ob-small" aria-live="polite">Loading more…</div>
      ) : null}
    </section>
  );
}
