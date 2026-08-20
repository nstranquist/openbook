import { api, postInput, type Id } from "@openbook/shared";
import { useMutation, useQuery } from "convex/react";
import { toast } from "../ui/garrid";
import { useState } from "react";
import { Avatar } from "./Avatar";
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, stripImageMetadata, uploadStorageFile } from "../lib/media";

// The "What's on your mind?" card. Collapsed = one-line prompt; expanded =
// textarea + audience picker. Audience is enforced server-side (posts.feed);
// the picker here just chooses it.
export function Composer({ groupId }: { groupId?: Id<"groups"> }) {
  const me = useQuery(api.profiles.me);
  const createPost = useMutation(api.posts.create);
  const generateUploadUrl = useMutation(api.posts.generateUploadUrl);
  const registerImage = useMutation(api.posts.registerImage);
  const registerVideo = useMutation(api.posts.registerVideo);
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<"public" | "friends">("public");
  const [imageId, setImageId] = useState<Id<"_storage"> | null>(null);
  const [videoId, setVideoId] = useState<Id<"_storage"> | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!me) return null;

  function resetComposer() {
    if (preview) URL.revokeObjectURL(preview);
    if (videoPreview) URL.revokeObjectURL(videoPreview);
    setBody("");
    setImageId(null);
    setVideoId(null);
    setPreview(null);
    setVideoPreview(null);
    setError(null);
    setOpen(false);
  }

  async function submit() {
    if (!body.trim() && !imageId && !videoId) {
      setError("Say something first");
      return;
    }
    const parsed = postInput.safeParse({ body, audience });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid post");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createPost({
        ...parsed.data,
        imageId: imageId ?? undefined,
        videoId: videoId ?? undefined,
        groupId,
      });
      resetComposer();
      toast("Posted", "ok");
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
            aria-label="Post body"
            onKeyDown={(e) => {
              if (e.key === "Escape") resetComposer();
            }}
          />
          {preview && (
            <img src={preview} alt="" className="ob-post-image" />
          )}
          {videoPreview && (
            <video src={videoPreview} className="ob-post-image" controls />
          )}
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
              <label className="ob-btn ob-btn--sm" style={{ cursor: "pointer" }}>
                Photo
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    if (!file.type.startsWith("image/")) {
                      setError("File must be an image");
                      return;
                    }
                    if (file.size > MAX_IMAGE_BYTES) {
                      setError("Image too large (max 5 MB)");
                      return;
                    }
                    if (preview) URL.revokeObjectURL(preview);
                    if (videoPreview) URL.revokeObjectURL(videoPreview);
                    setVideoId(null);
                    setVideoPreview(null);
                    setPreview(URL.createObjectURL(file));
                    void (async () => {
                      try {
                        const blob = await stripImageMetadata(file);
                        const prepared = new File([blob], file.name, { type: blob.type || file.type });
                        const storageId = await uploadStorageFile(prepared, generateUploadUrl);
                        await registerImage({ storageId });
                        setImageId(storageId);
                      } catch (err) {
                        setPreview(null);
                        setError(err instanceof Error ? err.message : "Upload failed");
                      }
                    })();
                  }}
                />
              </label>
              <label className="ob-btn ob-btn--sm" style={{ cursor: "pointer" }}>
                Video
                <input
                  type="file"
                  accept="video/mp4,video/webm"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    if (!file.type.startsWith("video/")) {
                      setError("File must be a video");
                      return;
                    }
                    if (file.size > MAX_VIDEO_BYTES) {
                      setError("Video too large (max 32 MB)");
                      return;
                    }
                    if (preview) URL.revokeObjectURL(preview);
                    if (videoPreview) URL.revokeObjectURL(videoPreview);
                    setImageId(null);
                    setPreview(null);
                    setVideoPreview(URL.createObjectURL(file));
                    void (async () => {
                      try {
                        const storageId = await uploadStorageFile(file, generateUploadUrl);
                        await registerVideo({ storageId });
                        setVideoId(storageId);
                      } catch (err) {
                        setVideoPreview(null);
                        setError(err instanceof Error ? err.message : "Upload failed");
                      }
                    })();
                  }}
                />
              </label>
              <button className="ob-btn ob-btn--sm" onClick={() => resetComposer()}>
                Cancel
              </button>
              <button
                className="ob-btn ob-btn--primary"
                disabled={busy || (!body.trim() && !imageId && !videoId)}
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
