import { api } from "@openbook/shared";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { Link, useNavigate } from "react-router-dom";
import { Avatar } from "../components/Avatar";
import { Composer } from "../components/Composer";
import { PostCard, type EnrichedPost } from "../components/PostCard";

// Home: the classic three-column layout. Left rail = identity + shortcuts,
// center = composer + the paginated reactive feed, right rail = contacts
// (click → DM) and People You May Know.

function LeftRail() {
  const me = useQuery(api.profiles.me);
  if (!me) return <div />;
  return (
    <div className="ob-rail ob-rail-left">
      <Link to={`/profile/${me.userId}`} className="ob-menu-item ob-card" style={{ padding: 10 }}>
        <Avatar name={me.displayName} hue={me.avatarHue} size={36} />
        <span className="ob-bold">{me.displayName}</span>
      </Link>
      <Link to="/friends" className="ob-menu-item">
        <span className="ob-iconbtn" style={{ fontSize: 18 }}>👥</span>
        <span className="ob-bold">Friends</span>
      </Link>
      <Link to="/messages" className="ob-menu-item">
        <span className="ob-iconbtn" style={{ fontSize: 18 }}>💬</span>
        <span className="ob-bold">Messages</span>
      </Link>
    </div>
  );
}

function RightRail() {
  const friends = useQuery(api.friends.list, {});
  const suggestions = useQuery(api.friends.suggestions);
  const sendRequest = useMutation(api.friends.sendRequest);
  const openDm = useMutation(api.messages.open);
  const navigate = useNavigate();

  async function message(userId: string) {
    const conversationId = await openDm({ userId: userId as never });
    navigate(`/messages/${conversationId}`);
  }

  return (
    <div className="ob-rail ob-rail-right">
      <div>
        <div className="ob-menu-head ob-muted" style={{ fontSize: 15 }}>Contacts</div>
        {(friends ?? []).length === 0 && (
          <div className="ob-empty ob-small">No friends yet — find people via search or <Link to="/friends">suggestions</Link>.</div>
        )}
        {(friends ?? []).map((f) => (
          <button key={f.userId} className="ob-menu-item" onClick={() => void message(f.userId)}>
            <Avatar name={f.displayName} hue={f.avatarHue} size={32} />
            <span className="ob-bold">{f.displayName}</span>
          </button>
        ))}
      </div>
      {(suggestions ?? []).length > 0 && (
        <div>
          <div className="ob-menu-head ob-muted" style={{ fontSize: 15 }}>People You May Know</div>
          {(suggestions ?? []).slice(0, 4).map((s) => (
            <div key={s.userId} className="ob-menu-item" style={{ cursor: "default" }}>
              <Avatar name={s.displayName} hue={s.avatarHue} size={32} userId={s.userId} />
              <span className="ob-grow">
                <Link to={`/profile/${s.userId}`} className="ob-link ob-bold">{s.displayName}</Link>
                {s.mutualCount > 0 && (
                  <div className="ob-muted" style={{ fontSize: 12 }}>
                    {s.mutualCount} mutual friend{s.mutualCount === 1 ? "" : "s"}
                  </div>
                )}
              </span>
              <button className="ob-btn ob-btn--sm" onClick={() => void sendRequest({ userId: s.userId as never })}>
                Add
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FeedSkeleton() {
  return (
    <>
      {[0, 1].map((i) => (
        <div key={i} className="ob-card ob-skel-card" aria-hidden="true">
          <div className="ob-skel-row">
            <div className="ob-skel ob-skel-avatar" />
            <div className="ob-grow" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="ob-skel ob-skel-line ob-skel-line--short" />
              <div className="ob-skel ob-skel-line" style={{ width: "28%", height: 10 }} />
            </div>
          </div>
          <div className="ob-skel ob-skel-line ob-skel-line--full ob-skel-line--body" />
          <div className="ob-skel ob-skel-line ob-skel-line--med ob-skel-line--body" />
        </div>
      ))}
    </>
  );
}

export function FeedPage() {
  const me = useQuery(api.profiles.me);
  const { results, status, loadMore } = usePaginatedQuery(
    api.posts.feed,
    {},
    { initialNumItems: 10 },
  );
  return (
    <div className="ob-grid">
      <LeftRail />
      <div className="ob-stack">
        <Composer />
        {status === "LoadingFirstPage" ? (
          <div aria-busy="true" aria-label="Loading your feed">
            <FeedSkeleton />
          </div>
        ) : results.length === 0 ? (
          <div className="ob-card ob-empty-cta">
            <p className="ob-bold" style={{ fontSize: 17 }}>
              Your feed is waiting
            </p>
            <p className="ob-muted ob-small">
              Post something above, or find people to follow via search and friend suggestions.
            </p>
            <div className="ob-empty-actions">
              <Link to="/friends" className="ob-btn ob-btn--primary">
                Find friends
              </Link>
            </div>
          </div>
        ) : (
          (results as EnrichedPost[]).map((post) => (
            <PostCard key={post._id} post={post} isMine={post.author.userId === me?.userId} />
          ))
        )}
        {status === "CanLoadMore" && (
          <button type="button" className="ob-btn" onClick={() => loadMore(10)}>
            Load more
          </button>
        )}
        {status === "LoadingMore" && (
          <div className="ob-empty ob-small" aria-live="polite">
            Loading more…
          </div>
        )}
      </div>
      <RightRail />
    </div>
  );
}
