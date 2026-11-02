import { api, type Id } from "@openbook/shared";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { type FormEvent, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Composer } from "../components/Composer";
import { Field } from "../components/Field";
import { PostCard, type EnrichedPost } from "../components/PostCard";
import { runOrToast } from "../lib/run";

function CreateGroup() {
  const create = useMutation(api.groups.create);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<"group" | "page">("group");
  const navigate = useNavigate();
  function submit(event: FormEvent) {
    event.preventDefault();
    void runOrToast(create({ name, description, kind }), "Could not create").then((id) => {
      if (!id) return;
      setName("");
      setDescription("");
      navigate(`/groups/${id}`);
    });
  }
  return (
    <form className="ob-card ob-stack ob-form" aria-labelledby="create-group-title" onSubmit={submit}>
      <h2 id="create-group-title" className="ob-form-title">Create a group or page</h2>
      <Field label="Name">
        <input
          className="g-input"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          required
        />
      </Field>
      <Field label="Description" hint="Optional. Add up to 500 characters.">
        <textarea
          className="g-textarea"
          name="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
        />
      </Field>
      <Field label="Type">
        <select
          className="g-select"
          name="kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as "group" | "page")}
        >
          <option value="group">Group</option>
          <option value="page">Page</option>
        </select>
      </Field>
      <button type="submit" className="ob-btn ob-btn--primary">Create</button>
    </form>
  );
}

function GroupDetail({ groupId }: { groupId: Id<"groups"> }) {
  const group = useQuery(api.groups.get, { groupId });
  const members = usePaginatedQuery(
    api.groups.membersPage,
    group?.role ? { groupId } : "skip",
    { initialNumItems: 50 },
  );
  const feed = usePaginatedQuery(
    api.groups.feedPage,
    group?.role ? { groupId } : "skip",
    { initialNumItems: 20 },
  );
  const join = useMutation(api.groups.join);
  const leave = useMutation(api.groups.leave);
  const me = useQuery(api.profiles.me);
  if (group === undefined) return <div className="ob-empty">Loading…</div>;
  if (group === null) return <div className="ob-empty">Group not found.</div>;
  return (
    <div className="ob-stack" style={{ maxWidth: 680, margin: "16px auto" }}>
      <Link to="/groups" className="ob-muted ob-small">← Groups</Link>
      <div className="ob-card">
        <div className="ob-bold" style={{ fontSize: 20 }}>{group.name}</div>
        <div className="ob-muted ob-small">{group.kind}{group.description ? ` · ${group.description}` : ""}</div>
        <div className="ob-row" style={{ marginTop: 8, gap: 8 }}>
          {!group.role && (
            <button className="ob-btn ob-btn--primary" onClick={() => void runOrToast(join({ groupId }), "Could not join")}>
              Join
            </button>
          )}
          {group.role === "member" && (
            <button className="ob-btn" onClick={() => void runOrToast(leave({ groupId }), "Could not leave")}>
              Leave
            </button>
          )}
        </div>
      </div>
      {group.role && (
        <>
          <Composer groupId={groupId} />
          {members.results.length > 0 && (
            <div className="ob-card ob-small ob-muted">
              {members.results.map((member) => member.displayName).join(" · ")}
              {members.status === "CanLoadMore" && (
                <button className="ob-btn ob-btn--sm" onClick={() => members.loadMore(50)}>
                  Load more members
                </button>
              )}
            </div>
          )}
          {feed.results.map((post) => (
            <PostCard key={post._id} post={post as EnrichedPost} isMine={post.author.userId === me?.userId} />
          ))}
          {feed.status === "CanLoadMore" && (
            <button className="ob-btn" onClick={() => feed.loadMore(20)}>Load more posts</button>
          )}
          {feed.status === "LoadingMore" && (
            <div className="ob-empty ob-small" aria-live="polite">Loading more posts…</div>
          )}
        </>
      )}
    </div>
  );
}

export function GroupsPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const mine = usePaginatedQuery(api.groups.listPage, groupId ? "skip" : {}, { initialNumItems: 30 });
  const discover = usePaginatedQuery(api.groups.discoverPage, groupId ? "skip" : {}, { initialNumItems: 30 });
  if (groupId) return <GroupDetail groupId={groupId as Id<"groups">} />;
  return (
    <div className="ob-stack" style={{ maxWidth: 680, margin: "16px auto" }}>
      <h1>Groups</h1>
      <CreateGroup />
      {mine.results.map((g) => (
        <Link key={g._id} to={`/groups/${g._id}`} className="ob-card ob-link">
          <div className="ob-bold">{g.name}</div>
          <div className="ob-muted ob-small">{g.kind} · {g.role}</div>
        </Link>
      ))}
      {mine.status === "CanLoadMore" && (
        <button className="ob-btn" onClick={() => mine.loadMore(30)}>Load more groups</button>
      )}
      {discover.results.length > 0 && (
        <>
          <h2 className="ob-muted" style={{ fontSize: 15 }}>Discover</h2>
          {discover.results.map((g) => (
            <Link key={g._id} to={`/groups/${g._id}`} className="ob-card ob-link">
              <div className="ob-bold">{g.name}</div>
              <div className="ob-muted ob-small">{g.kind}</div>
            </Link>
          ))}
          {discover.status === "CanLoadMore" && (
            <button className="ob-btn" onClick={() => discover.loadMore(30)}>Discover more groups</button>
          )}
        </>
      )}
    </div>
  );
}
