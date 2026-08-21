import { api, type Id } from "@openbook/shared";
import { useMutation, useQuery } from "convex/react";
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
    <form className="ob-card ob-stack ob-form" onSubmit={submit}>
      <h2 className="ob-form-title">Create a group or page</h2>
      <Field label="Name">
        <input
          className="g-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          required
        />
      </Field>
      <Field label="Description" hint="Optional. Add up to 500 characters.">
        <textarea
          className="g-textarea"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
        />
      </Field>
      <Field label="Type">
        <select
          className="g-select"
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
  const members = useQuery(api.groups.members, group?.role ? { groupId } : "skip");
  const feed = useQuery(api.groups.feed, group?.role ? { groupId } : "skip") ?? [];
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
          {(members ?? []).length > 0 && (
            <div className="ob-card ob-small ob-muted">
              {(members ?? []).map((m) => m.displayName).join(" · ")}
            </div>
          )}
          {feed.map((post) => (
            <PostCard key={post._id} post={post as EnrichedPost} isMine={post.author.userId === me?.userId} />
          ))}
        </>
      )}
    </div>
  );
}

export function GroupsPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const mine = useQuery(api.groups.list) ?? [];
  const discover = useQuery(api.groups.discover) ?? [];
  if (groupId) return <GroupDetail groupId={groupId as Id<"groups">} />;
  return (
    <div className="ob-stack" style={{ maxWidth: 680, margin: "16px auto" }}>
      <h1>Groups</h1>
      <CreateGroup />
      {mine.map((g) => (
        <Link key={g._id} to={`/groups/${g._id}`} className="ob-card ob-link">
          <div className="ob-bold">{g.name}</div>
          <div className="ob-muted ob-small">{g.kind} · {g.role}</div>
        </Link>
      ))}
      {discover.length > 0 && (
        <>
          <h2 className="ob-muted" style={{ fontSize: 15 }}>Discover</h2>
          {discover.map((g) => (
            <Link key={g._id} to={`/groups/${g._id}`} className="ob-card ob-link">
              <div className="ob-bold">{g.name}</div>
              <div className="ob-muted ob-small">{g.kind}</div>
            </Link>
          ))}
        </>
      )}
    </div>
  );
}
