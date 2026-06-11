import { api, profileInput, type Id } from "@openbook/shared";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Avatar } from "../components/Avatar";
import { Composer } from "../components/Composer";
import { PostCard, type EnrichedPost } from "../components/PostCard";
import { joinedLabel } from "../lib/format";

// A profile: gradient cover (deterministic hue), identity header with the
// relationship-aware action button, and Posts / About / Friends tabs.

function FriendButton({
  userId,
  relationship,
}: {
  userId: Id<"users">;
  relationship: "self" | "friends" | "outgoing_request" | "incoming_request" | "none";
}) {
  const sendRequest = useMutation(api.friends.sendRequest);
  const accept = useMutation(api.friends.accept);
  const decline = useMutation(api.friends.decline);
  const cancelRequest = useMutation(api.friends.cancelRequest);
  const unfriend = useMutation(api.friends.unfriend);
  const openDm = useMutation(api.messages.open);
  const navigate = useNavigate();

  if (relationship === "self") return null;
  const dmButton = (
    <button
      className="ob-btn"
      onClick={() =>
        void openDm({ userId }).then((conversationId) =>
          navigate(`/messages/${conversationId}`),
        )
      }
    >
      💬 Message
    </button>
  );
  switch (relationship) {
    case "none":
      return (
        <span className="ob-row" style={{ gap: 8 }}>
          <button className="ob-btn ob-btn--primary" onClick={() => void sendRequest({ userId })}>
            ➕ Add Friend
          </button>
          {dmButton}
        </span>
      );
    case "outgoing_request":
      return (
        <span className="ob-row" style={{ gap: 8 }}>
          <button className="ob-btn" onClick={() => void cancelRequest({ userId })}>
            Cancel Request
          </button>
          {dmButton}
        </span>
      );
    case "incoming_request":
      return (
        <span className="ob-row" style={{ gap: 8 }}>
          <button className="ob-btn ob-btn--primary" onClick={() => void accept({ userId })}>
            Confirm Request
          </button>
          <button className="ob-btn" onClick={() => void decline({ userId })}>
            Delete Request
          </button>
        </span>
      );
    case "friends":
      return (
        <span className="ob-row" style={{ gap: 8 }}>
          <button
            className="ob-btn"
            onClick={() => {
              if (confirm("Remove this friend?")) void unfriend({ userId });
            }}
          >
            ✓ Friends
          </button>
          {dmButton}
        </span>
      );
  }
}

function EditProfile({ profile, onDone }: { profile: { displayName: string; bio?: string; work?: string; location?: string }; onDone: () => void }) {
  const update = useMutation(api.profiles.update);
  const [form, setForm] = useState({
    displayName: profile.displayName,
    bio: profile.bio ?? "",
    work: profile.work ?? "",
    location: profile.location ?? "",
  });
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const parsed = profileInput.safeParse(form);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid profile");
      return;
    }
    try {
      await update(parsed.data);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    }
  }

  const field = (key: keyof typeof form, label: string) => (
    <div className="g-field">
      <label className="g-label">{label}</label>
      <input
        className="g-input"
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
    </div>
  );
  return (
    <div className="ob-card ob-reveal" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <span className="ob-bold" style={{ fontSize: 17 }}>Edit profile</span>
      {field("displayName", "Name")}
      {field("bio", "Bio")}
      {field("work", "Work")}
      {field("location", "Location")}
      {error && <div className="ob-small" style={{ color: "var(--danger)" }}>{error}</div>}
      <span className="ob-row" style={{ gap: 8 }}>
        <button className="ob-btn ob-btn--primary" onClick={() => void save()}>Save</button>
        <button className="ob-btn" onClick={onDone}>Cancel</button>
      </span>
    </div>
  );
}

function AboutCard({ profile }: { profile: { bio?: string; work?: string; location?: string; joinedAt: number } }) {
  return (
    <div className="ob-card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span className="ob-bold" style={{ fontSize: 17 }}>Intro</span>
      {profile.bio && <span>{profile.bio}</span>}
      {profile.work && <span>💼 Works at <b>{profile.work}</b></span>}
      {profile.location && <span>📍 Lives in <b>{profile.location}</b></span>}
      <span className="ob-muted">🕓 Joined {joinedLabel(profile.joinedAt)}</span>
    </div>
  );
}

function ProfileFriends({ userId }: { userId: Id<"users"> }) {
  const friends = useQuery(api.friends.list, { userId });
  return (
    <div className="ob-card">
      <span className="ob-bold" style={{ fontSize: 17 }}>Friends</span>
      {(friends ?? []).length === 0 ? (
        <div className="ob-empty ob-small">No friends to show.</div>
      ) : (
        <div className="ob-people-grid" style={{ marginTop: 10 }}>
          {(friends ?? []).map((f) => (
            <div key={f.userId} className="ob-menu-item" style={{ cursor: "default" }}>
              <Avatar name={f.displayName} hue={f.avatarHue} size={36} userId={f.userId} />
              <span className="ob-bold ob-small">{f.displayName}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ProfilePage() {
  const { userId } = useParams<{ userId: string }>();
  const id = userId as Id<"users">;
  const profile = useQuery(api.profiles.view, userId ? { userId: id } : "skip");
  const me = useQuery(api.profiles.me);
  const [tab, setTab] = useState<"posts" | "about" | "friends">("posts");
  const [editing, setEditing] = useState(false);
  const { results, status, loadMore } = usePaginatedQuery(
    api.posts.forProfile,
    userId ? { userId: id } : "skip",
    { initialNumItems: 10 },
  );

  if (profile === undefined) return <div className="ob-empty">Loading profile…</div>;
  if (profile === null) return <div className="ob-empty">This profile does not exist.</div>;

  return (
    <div className="ob-reveal">
      <div style={{ background: "var(--ob-card)", boxShadow: "var(--ob-shadow)" }}>
        <div className="ob-profile-head" style={{ padding: 0 }}>
          <div
            className="ob-cover"
            style={{
              background: `linear-gradient(120deg, oklch(0.55 0.16 ${profile.coverHue}), oklch(0.7 0.14 ${(profile.coverHue + 70) % 360}))`,
            }}
          />
        </div>
        <div className="ob-profile-head">
          <div className="ob-profile-id">
            <Avatar name={profile.displayName} hue={profile.avatarHue} size={130} />
            <div className="ob-grow" style={{ paddingBottom: 8 }}>
              <h1 className="ob-profile-name">{profile.displayName}</h1>
              {profile.bio && <div className="ob-muted">{profile.bio}</div>}
            </div>
            <div style={{ paddingBottom: 12 }}>
              {profile.isMe ? (
                <button className="ob-btn" onClick={() => setEditing((v) => !v)}>
                  ✏️ Edit profile
                </button>
              ) : (
                <FriendButton userId={id} relationship={profile.relationship} />
              )}
            </div>
          </div>
          <div className="ob-tabs">
            {(["posts", "about", "friends"] as const).map((t) => (
              <button
                key={t}
                className={`ob-ptab${tab === t ? " active" : ""}`}
                onClick={() => setTab(t)}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="ob-grid" style={{ gridTemplateColumns: "minmax(0, 680px)" }}>
        <div className="ob-stack">
          {editing && profile.isMe && (
            <EditProfile profile={profile} onDone={() => setEditing(false)} />
          )}
          {tab === "about" && <AboutCard profile={profile} />}
          {tab === "friends" && <ProfileFriends userId={id} />}
          {tab === "posts" && (
            <>
              <AboutCard profile={profile} />
              {profile.isMe && <Composer />}
              {status === "LoadingFirstPage" ? (
                <div className="ob-card ob-empty">Loading posts…</div>
              ) : results.length === 0 ? (
                <div className="ob-card ob-empty">No posts to show.</div>
              ) : (
                (results as EnrichedPost[]).map((post) => (
                  <PostCard key={post._id} post={post} isMine={post.author.userId === me?.userId} />
                ))
              )}
              {status === "CanLoadMore" && (
                <button className="ob-btn" onClick={() => loadMore(10)}>Load more</button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
