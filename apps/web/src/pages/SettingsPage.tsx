import { api, useAuth, type Id } from "@openbook/shared";
import { useMutation, useQuery } from "convex/react";
import { type FormEvent, useEffect, useState } from "react";
import { ThemeToggle, toast } from "../ui/garrid";
import { Avatar } from "../components/Avatar";
import { BillingPanel } from "../components/BillingPanel";
import { Field } from "../components/Field";
import { runOrToast } from "../lib/run";
import { subscribePush, unsubscribePush } from "../lib/push";

function PushCard() {
  const vapid = useQuery(api.push.vapidPublicKey);
  const mine = useQuery(api.push.mine);
  const subscribe = useMutation(api.push.subscribe);
  const unsubscribe = useMutation(api.push.unsubscribe);
  const [busy, setBusy] = useState(false);
  if (vapid === undefined) return null;
  if (!vapid) {
    return (
      <div className="g-card" style={{ marginTop: "var(--space-5)" }}>
        <div className="g-card-title">Browser notifications</div>
        <div className="g-hint">
          Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY on the deployment to enable push.
        </div>
      </div>
    );
  }
  const on = (mine ?? []).length > 0;
  return (
    <div className="g-card" style={{ marginTop: "var(--space-5)" }}>
      <div className="g-spread">
        <div>
          <div className="g-card-title">Browser notifications</div>
          <div className="g-hint">
            {on ? "This device is subscribed." : "Get a push when someone messages or mentions you."}
          </div>
        </div>
        <button
          className="g-btn g-btn--sm"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            const work = on
              ? unsubscribePush(unsubscribe)
              : subscribePush(vapid, subscribe);
            void work
              .then(() => toast(on ? "Notifications off" : "Notifications on", "ok"))
              .catch((e) => toast(e instanceof Error ? e.message : "Could not update push", "err"))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "Working…" : on ? "Disable" : "Enable"}
        </button>
      </div>
    </div>
  );
}

function PasswordChange() {
  const me = useQuery(api.profiles.me);
  const { changePassword } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const email = me?.email;
  if (!email) return null;
  const accountEmail = email;
  function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    void changePassword(accountEmail, currentPassword, nextPassword)
      .then(() => {
        toast("Password updated", "ok");
        setCurrentPassword("");
        setNextPassword("");
      })
      .catch((error) =>
        toast(error instanceof Error ? error.message : "Could not change password", "err"),
      )
      .finally(() => setBusy(false));
  }
  return (
    <div className="g-card" style={{ marginTop: "var(--space-5)" }}>
      <div id="password-settings-title" className="g-card-title">Password</div>
      <div className="g-hint">Change your password while signed in. Social-login accounts skip this.</div>
      <form
        className="g-stack ob-form"
        style={{ marginTop: "var(--space-3)" }}
        aria-labelledby="password-settings-title"
        onSubmit={submit}
      >
        <Field label="Current password">
          <input
            className="g-input"
            name="current-password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
        </Field>
        <Field label="New password" hint="Use at least 8 characters.">
          <input
            className="g-input"
            name="new-password"
            type="password"
            autoComplete="new-password"
            value={nextPassword}
            onChange={(e) => setNextPassword(e.target.value)}
            minLength={8}
            required
          />
        </Field>
        <button
          type="submit"
          className="g-btn g-btn--primary"
          disabled={busy || !currentPassword || nextPassword.length < 8}
        >
          {busy ? "Saving…" : "Update password"}
        </button>
      </form>
    </div>
  );
}

function MutedList() {
  const muted = useQuery(api.mutes.list);
  const setMute = useMutation(api.mutes.set);
  if (!muted || muted.length === 0) return null;
  return (
    <div className="g-card" style={{ marginTop: "var(--space-5)" }}>
      <div className="g-card-title">Muted</div>
      <div className="g-hint">Their posts stay off your feed. You remain friends.</div>
      {muted.map((row) => (
        <div key={row.userId} className="g-spread" style={{ marginTop: "var(--space-3)" }}>
          <span className="ob-row" style={{ gap: 8 }}>
            <Avatar name={row.displayName} hue={row.avatarHue} size={32} userId={row.userId} />
            <span className="ob-bold">{row.displayName}</span>
          </span>
          <button
            className="g-btn g-btn--sm"
            onClick={() => void runOrToast(setMute({ userId: row.userId as Id<"users">, muted: false }), "Could not unmute")}
          >
            Unmute
          </button>
        </div>
      ))}
    </div>
  );
}

function OperatorQueue() {
  const me = useQuery(api.profiles.me);
  const queue = useQuery(api.reports.queue, me?.isOperator ? {} : "skip");
  const review = useMutation(api.reports.review);
  if (!me?.isOperator) return null;
  return (
    <div className="g-card" style={{ marginTop: "var(--space-5)" }}>
      <div className="g-card-title">Report queue</div>
      <div className="g-hint">OPERATOR_USER_IDS on the deployment gates this list.</div>
      {(queue ?? []).length === 0 && <div className="ob-empty ob-small">No open reports.</div>}
      {(queue ?? []).map((row) => (
        <div key={row._id} className="g-spread" style={{ marginTop: "var(--space-3)" }}>
          <span className="ob-small">{row.reason}</span>
          <button className="g-btn g-btn--sm" onClick={() => void runOrToast(review({ id: row._id, status: "closed" }), "Could not close")}>
            Close
          </button>
        </div>
      ))}
    </div>
  );
}

function BlockedList() {
  const blocked = useQuery(api.blocks.list);
  const setBlock = useMutation(api.blocks.set);
  if (!blocked || blocked.length === 0) return null;
  return (
    <div className="g-card" style={{ marginTop: "var(--space-5)" }}>
      <div className="g-card-title">Blocked</div>
      <div className="g-hint">They cannot see your posts or send friend requests.</div>
      {blocked.map((row) => (
        <div key={row.userId} className="g-spread" style={{ marginTop: "var(--space-3)" }}>
          <span className="ob-row" style={{ gap: 8 }}>
            <Avatar name={row.displayName} hue={row.avatarHue} size={32} userId={row.userId} />
            <span className="ob-bold">{row.displayName}</span>
          </span>
          <button
            className="g-btn g-btn--sm"
            onClick={() => void runOrToast(setBlock({ userId: row.userId as Id<"users">, blocked: false }), "Could not unblock")}
          >
            Unblock
          </button>
        </div>
      ))}
    </div>
  );
}

function DeleteAccountButton() {
  const del = useMutation(api.profiles.deleteAccount);
  const { signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="g-btn g-btn--danger"
      disabled={busy}
      onClick={() => {
        if (!confirm("Close this account permanently?")) return;
        setBusy(true);
        void runOrToast(del({}), "Could not close account").then(async (ok) => {
          setBusy(false);
          if (ok !== undefined) await signOut();
        });
      }}
    >
      {busy ? "Working…" : "Close account"}
    </button>
  );
}

// SettingsPage — a real, backend-wired settings surface: profile edit (→
// profiles.update), appearance (DS ThemeToggle), and account/danger-zone.
export function SettingsPage() {
  const me = useQuery(api.profiles.me);
  const update = useMutation(api.profiles.update);
  const { signOut } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [work, setWork] = useState("");
  const [location, setLocation] = useState("");
  const [bioAudience, setBioAudience] = useState<"public" | "friends">("public");
  const [friendsListPublic, setFriendsListPublic] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (me && !loaded) {
      setDisplayName(me.displayName ?? "");
      setBio(me.bio ?? "");
      setWork(me.work ?? "");
      setLocation(me.location ?? "");
      setBioAudience(me.bioAudience === "friends" ? "friends" : "public");
      setFriendsListPublic(me.friendsListPublic !== false);
      setLoaded(true);
    }
  }, [me, loaded]);

  if (me === undefined) return <section style={mainStyle} aria-busy="true"><p className="ob-muted">Loading…</p></section>;
  if (me === null) return null;

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await update({ displayName, bio, work, location, bioAudience, friendsListPublic });
      toast("Profile saved", "ok");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Save failed", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={mainStyle} aria-labelledby="settings-title">
      <h1 id="settings-title" style={{ fontFamily: "var(--font-display)", marginBottom: "var(--space-5)" }}>Settings</h1>

      <form className="g-card" aria-labelledby="profile-settings-title" onSubmit={(event) => void save(event)}>
        <div className="g-card-head">
          <h2 id="profile-settings-title" className="g-card-title">Profile</h2>
          <Avatar name={displayName || me.displayName} hue={me.avatarHue} size={44} />
        </div>
        <div className="g-stack" style={{ gap: "var(--space-4)" }}>
          <Field label="Display name">
            <input
              className="g-input"
              name="displayName"
              autoComplete="name"
              maxLength={80}
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </Field>
          <Field label="Bio" hint="Optional. Add up to 500 characters.">
            <textarea
              className="g-textarea"
              name="bio"
              maxLength={500}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
            />
          </Field>
          <div className="g-row ob-form-row" style={{ gap: "var(--space-4)", alignItems: "flex-start" }}>
            <Field label="Work" className="ob-grow">
              <input
                className="g-input"
                name="work"
                autoComplete="organization"
                maxLength={500}
                value={work}
                onChange={(e) => setWork(e.target.value)}
              />
            </Field>
            <Field label="Location" className="ob-grow">
              <input
                className="g-input"
                name="location"
                autoComplete="address-level2"
                maxLength={500}
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </Field>
          </div>
          <Field label="About visibility">
            <select
              className="g-input"
              name="bioAudience"
              value={bioAudience}
              onChange={(e) => setBioAudience(e.target.value as "public" | "friends")}
            >
              <option value="public">Public</option>
              <option value="friends">Friends only</option>
            </select>
          </Field>
          <label className="ob-small" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              name="friendsListPublic"
              checked={friendsListPublic}
              onChange={(e) => setFriendsListPublic(e.target.checked)}
            />
            Show my friends list on my profile
          </label>
          <div className="g-row" style={{ justifyContent: "flex-end" }}>
            <button type="submit" className="g-btn g-btn--primary" disabled={busy || !displayName.trim()}>
              Save changes
            </button>
          </div>
        </div>
      </form>

      <PasswordChange />

      <PushCard />

      <BillingPanel />

      <div className="g-card" style={{ marginTop: "var(--space-5)" }}>
        <div className="g-spread">
          <div>
            <div className="g-card-title">Appearance</div>
            <div className="g-hint">Switch between light and dark.</div>
          </div>
          <ThemeToggle />
        </div>
      </div>

      <MutedList />

      <BlockedList />

      <OperatorQueue />

      <div className="g-card" style={{ marginTop: "var(--space-5)", borderColor: "color-mix(in oklch, var(--danger), transparent 60%)" }}>
        <div className="g-spread">
          <div>
            <div className="g-card-title">Account</div>
            <div className="g-hint">Sign out of openbook on this device.</div>
          </div>
          <button className="g-btn g-btn--danger" onClick={() => void signOut()}>Log out</button>
        </div>
        <div className="g-spread" style={{ marginTop: "var(--space-4)" }}>
          <div>
            <div className="g-card-title">Close account</div>
            <div className="g-hint">Deletes your posts, comments, and friend graph. This cannot be undone.</div>
          </div>
          <DeleteAccountButton />
        </div>
      </div>
    </section>
  );
}

const mainStyle: React.CSSProperties = { maxWidth: 680, margin: "0 auto", padding: "var(--space-6) var(--space-4)" };
