import { api, postInput } from "@openbook/shared";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Avatar } from "./Avatar";

// The "What's on your mind?" card. Collapsed = one-line prompt; expanded =
// textarea + audience picker. Audience is enforced server-side (posts.feed);
// the picker here just chooses it.
export function Composer() {
  const me = useQuery(api.profiles.me);
  const createPost = useMutation(api.posts.create);
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<"public" | "friends">("public");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!me) return null;

  async function submit() {
    const parsed = postInput.safeParse({ body, audience });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid post");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createPost(parsed.data);
      setBody("");
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ob-card">
      <div className="ob-row">
        <Avatar name={me.displayName} hue={me.avatarHue} userId={me.userId} />
        {!open ? (
          <button className="ob-composer-open" onClick={() => setOpen(true)}>
            What's on your mind, {me.displayName.split(" ")[0]}?
          </button>
        ) : (
          <span className="ob-bold">{me.displayName}</span>
        )}
      </div>
      {open && (
        <div className="ob-reveal">
          <textarea
            autoFocus
            className="ob-textarea"
            placeholder={`What's on your mind, ${me.displayName.split(" ")[0]}?`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          {error && <div className="ob-small" style={{ color: "var(--danger)" }}>{error}</div>}
          <div className="ob-row" style={{ justifyContent: "space-between", marginTop: 8 }}>
            <select
              className="ob-select"
              value={audience}
              onChange={(e) => setAudience(e.target.value as "public" | "friends")}
              aria-label="Who can see this post"
            >
              <option value="public">🌐 Public</option>
              <option value="friends">👥 Friends</option>
            </select>
            <span className="ob-row" style={{ gap: 8 }}>
              <button className="ob-btn ob-btn--sm" onClick={() => { setOpen(false); setBody(""); setError(null); }}>
                Cancel
              </button>
              <button
                className="ob-btn ob-btn--primary"
                disabled={busy || !body.trim()}
                onClick={() => void submit()}
              >
                Post
              </button>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
