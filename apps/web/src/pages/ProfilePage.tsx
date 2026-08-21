import { api, profileInput, type Id } from "@openbook/shared";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { type FormEvent, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { runOrToast } from "../lib/run";
import { stripImageMetadata, uploadStorageFile } from "../lib/media";
import { Avatar } from "../components/Avatar";
import { Composer } from "../components/Composer";
import { Field } from "../components/Field";
import { PostCard, type EnrichedPost } from "../components/PostCard";
import { joinedLabel } from "../lib/format";

// A profile: gradient cover (deterministic hue), identity header with the
// relationship-aware action button, and Posts / About / Friends tabs.

function FriendButton({
  userId,
  relationship,
  muted,
}: {
  userId: Id<"users">;
  relationship: "self" | "friends" | "outgoing_request" | "incoming_request" | "blocked" | "blocked_by" | "none";
  muted?: boolean;
}) {
  const sendRequest = useMutation(api.friends.sendRequest);
  const accept = useMutation(api.friends.accept);
  const decline = useMutation(api.friends.decline);
  const cancelRequest = useMutation(api.friends.cancelRequest);
  const unfriend = useMutation(api.friends.unfriend);
  const setBlock = useMutation(api.blocks.set);
  const setMute = useMutation(api.mutes.set);
  const report = useMutation(api.reports.create);
  const openDm = useMutation(api.messages.open);
  const navigate = useNavigate();

  if (relationship === "self") return null;
  const blockButton = (
    <button
      className="ob-btn"
      onClick={() => {
        if (confirm("Block this person? You will unfriend them and hide each other's posts.")) {
          void runOrToast(setBlock({ userId, blocked: true }), "Could not block");
        }
      }}
    >
      Block
    </button>
  );
  const dmButton = (
    <button
      type="button"
      className="ob-btn"
      aria-label="Message"
      onClick={() =>
        void runOrToast(openDm({ userId }), "Could not open messages").then((conversationId) => {
          if (conversationId) navigate(`/messages/${conversationId}`);
        })
      }
    >
      💬 Message
    </button>
  );
  const muteButton = (
    <button
      className="ob-btn"
      onClick={() =>
        void runOrToast(
          setMute({ userId, muted: !muted }),
          "Could not update mute",
        )
      }
    >
      {muted ? "Unmute" : "Mute"}
    </button>
  );
  const reportButton = (
    <button
      className="ob-btn"
      onClick={() => {
        const reason = prompt("Why are you reporting this person?");
        if (!reason?.trim()) return;
        void runOrToast(report({ targetUserId: userId, reason }), "Could not report");
      }}
    >
      Report
    </button>
  );
  switch (relationship) {
    case "blocked":
      return (
        <span className="ob-row" style={{ gap: 8 }}>
          <button className="ob-btn" onClick={() => void runOrToast(setBlock({ userId, blocked: false }), "Could not unblock")}>
            Unblock
          </button>
        </span>
      );
    case "blocked_by":
      return <span className="ob-muted ob-small">This profile is unavailable.</span>;
    case "none":
      return (
        <span className="ob-row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button className="ob-btn ob-btn--primary" onClick={() => void runOrToast(sendRequest({ userId }), "Could not send request")}>
            ➕ Add Friend
          </button>
          {muteButton}
          {blockButton}
          {reportButton}
        </span>
      );
    case "outgoing_request":
      return (
        <span className="ob-row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button className="ob-btn" onClick={() => void runOrToast(cancelRequest({ userId }), "Could not cancel")}>
            Cancel Request
          </button>
          {muteButton}
          {blockButton}
          {reportButton}
        </span>
      );
    case "incoming_request":
      return (
        <span className="ob-row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button className="ob-btn ob-btn--primary" onClick={() => void runOrToast(accept({ userId }), "Could not accept")}>
            Confirm Request
          </button>
          <button className="ob-btn" onClick={() => void runOrToast(decline({ userId }), "Could not decline")}>
            Delete Request
          </button>
          {muteButton}
          {blockButton}
          {reportButton}
        </span>
      );
    case "friends":
      return (
        <span className="ob-row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button
            className="ob-btn"
            onClick={() => {
              if (confirm("Remove this friend?")) void runOrToast(unfriend({ userId }), "Could not unfriend");
            }}
          >
            ✓ Friends
          </button>
          {dmButton}
          {muteButton}
          {blockButton}
          {reportButton}
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

  async function save(event?: FormEvent) {
    event?.preventDefault();
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

  const field = (key: keyof typeof form, label: string, multiline = false) => (
    <Field label={label}>
      {multiline ? (
        <textarea
          className="g-textarea"
          name={key}
          maxLength={500}
          value={form[key]}
          onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        />
      ) : (
        <input
          className="g-input"
          name={key}
          autoComplete={key === "displayName" ? "name" : key === "work" ? "organization" : key === "location" ? "address-level2" : undefined}
          maxLength={key === "displayName" ? 80 : 500}
          required={key === "displayName"}
          value={form[key]}
          onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        />
      )}
    </Field>
  );
  return (
    <form className="ob-card ob-reveal ob-form" aria-labelledby="edit-profile-title" onSubmit={(event) => void save(event)}>
      <h2 id="edit-profile-title" className="ob-form-title">Edit profile</h2>
      {field("displayName", "Name")}
      {field("bio", "Bio", true)}
      {field("work", "Work")}
      {field("location", "Location")}
      {error && <div className="g-error-text" role="alert">{error}</div>}
      <span className="ob-row" style={{ gap: 8 }}>
        <button type="submit" className="ob-btn ob-btn--primary">Save</button>
        <button type="button" className="ob-btn" onClick={onDone}>Cancel</button>
      </span>
    </form>
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

function AlbumsCard({ userId, isMe }: { userId: Id<"users">; isMe: boolean }) {
  const albums = useQuery(api.albums.listMine, { userId });
  const create = useMutation(api.albums.create);
  const addPhoto = useMutation(api.albums.addPhoto);
  const generateUploadUrl = useMutation(api.posts.generateUploadUrl);
  return (
    <div className="ob-card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span className="ob-bold" style={{ fontSize: 17 }}>Albums</span>
      {isMe && (
        <button
          className="ob-btn"
          onClick={() => {
            const title = prompt("Album title");
            if (!title?.trim()) return;
            void runOrToast(create({ title }), "Could not create album");
          }}
        >
          New album
        </button>
      )}
      {(albums ?? []).length === 0 ? (
        <div className="ob-empty ob-small">No albums yet.</div>
      ) : (
        (albums ?? []).map((a) => (
          <div key={a._id} className="ob-row" style={{ gap: 8 }}>
            {a.coverUrls[0] ? (
              <img src={a.coverUrls[0]} alt="" width={48} height={48} style={{ objectFit: "cover", borderRadius: 8 }} />
            ) : (
              <div style={{ width: 48, height: 48, background: "var(--border)", borderRadius: 8 }} />
            )}
            <span className="ob-grow">
              <span className="ob-bold">{a.title}</span>
              <div className="ob-muted ob-small">{a.itemCount} photos</div>
            </span>
            {isMe && (
              <label className="ob-btn">
                Add photo
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    void (async () => {
                      const prepared = new File([await stripImageMetadata(file)], file.name, { type: file.type });
                      const imageId = await uploadStorageFile(prepared, generateUploadUrl);
                      await runOrToast(addPhoto({ albumId: a._id, imageId }), "Could not add photo");
                    })();
                  }}
                />
              </label>
            )}
          </div>
        ))
      )}
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
  const [tab, setTab] = useState<"posts" | "about" | "friends" | "albums">("posts");
  const [editing, setEditing] = useState(false);
  const { results, status, loadMore } = usePaginatedQuery(
    api.posts.forProfile,
    userId ? { userId: id } : "skip",
    { initialNumItems: 10 },
  );
  useEffect(() => {
    if (status === "CanLoadMore" && results.length === 0) loadMore(10);
  }, [status, results.length, loadMore]);
  const postsEmpty = results.length === 0 && status === "Exhausted";
  const postsLoading =
    status === "LoadingFirstPage" || (results.length === 0 && status !== "Exhausted");

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
              {profile.lastSeenAt ? (
                <div className="ob-muted ob-small">Last seen {joinedLabel(profile.lastSeenAt)}</div>
              ) : null}
            </div>
            <div style={{ paddingBottom: 12 }}>
              {profile.isMe ? (
                <button className="ob-btn" onClick={() => setEditing((v) => !v)}>
                  ✏️ Edit profile
                </button>
              ) : (
                <FriendButton userId={id} relationship={profile.relationship} muted={profile.muted} />
              )}
            </div>
          </div>
          <div className="ob-tabs">
            {(["posts", "about", "friends", "albums"] as const).map((t) => (
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
          {tab === "albums" && <AlbumsCard userId={id} isMe={!!profile.isMe} />}
          {tab === "posts" && (
            <>
              <AboutCard profile={profile} />
              {profile.isMe && <Composer />}
              {postsLoading ? (
                <div className="ob-card ob-empty">Loading posts…</div>
              ) : postsEmpty ? (
                <div className="ob-card ob-empty">No posts to show.</div>
              ) : (
                (results as EnrichedPost[]).map((post) => (
                  <PostCard key={post._id} post={post} isMine={post.author.userId === me?.userId} />
                ))
              )}
              {status === "CanLoadMore" && results.length > 0 && (
                <button className="ob-btn" onClick={() => loadMore(10)}>Load more</button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
