import { api, type Id } from "@openbook/shared";
import { useMutation, useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { Avatar } from "../components/Avatar";
import { runOrToast } from "../lib/run";

// Friend center: incoming requests (Confirm/Delete), outgoing (Cancel),
// People You May Know (ranked by mutual friends), and the full friends list.

function PersonCard({
  userId,
  displayName,
  avatarHue,
  subtitle,
  children,
}: {
  userId: string;
  displayName: string;
  avatarHue: number;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="ob-person-card">
      <Link
        to={`/profile/${userId}`}
        className="ob-person-cover"
        style={{
          background: `linear-gradient(135deg, oklch(0.62 0.16 ${avatarHue}), oklch(0.45 0.17 ${(avatarHue + 50) % 360}))`,
          textDecoration: "none",
        }}
      >
        <Avatar name={displayName} hue={avatarHue} size={72} />
      </Link>
      <div className="body">
        <Link to={`/profile/${userId}`} className="ob-link ob-bold">
          {displayName}
        </Link>
        {subtitle && <span className="ob-muted ob-small">{subtitle}</span>}
        {children}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="ob-reveal">
      <h2 style={{ fontSize: 20, margin: "8px 0 12px" }}>{title}</h2>
      {children}
    </section>
  );
}

export function FriendsPage() {
  const requests = useQuery(api.friends.requests);
  const suggestions = useQuery(api.friends.suggestions);
  const friends = useQuery(api.friends.list, {});
  const accept = useMutation(api.friends.accept);
  const decline = useMutation(api.friends.decline);
  const cancelRequest = useMutation(api.friends.cancelRequest);
  const sendRequest = useMutation(api.friends.sendRequest);
  const unfriend = useMutation(api.friends.unfriend);

  const asId = (s: string) => s as Id<"users">;

  return (
    <div className="ob-grid" style={{ gridTemplateColumns: "minmax(0, 940px)" }}>
      <div className="ob-stack" style={{ gap: 24 }}>
        {(requests?.incoming.length ?? 0) > 0 && (
          <Section title={`Friend Requests (${requests!.incoming.length})`}>
            <div className="ob-people-grid">
              {requests!.incoming.map((p) => (
                <PersonCard key={p.userId} userId={p.userId} displayName={p.displayName} avatarHue={p.avatarHue}>
                  <button className="ob-btn ob-btn--primary ob-btn--sm" onClick={() => void runOrToast(accept({ userId: asId(p.userId) }), "Could not accept")}>
                    Confirm
                  </button>
                  <button className="ob-btn ob-btn--sm" onClick={() => void runOrToast(decline({ userId: asId(p.userId) }), "Could not decline")}>
                    Delete
                  </button>
                </PersonCard>
              ))}
            </div>
          </Section>
        )}

        {(requests?.outgoing.length ?? 0) > 0 && (
          <Section title="Sent Requests">
            <div className="ob-people-grid">
              {requests!.outgoing.map((p) => (
                <PersonCard key={p.userId} userId={p.userId} displayName={p.displayName} avatarHue={p.avatarHue} subtitle="Request sent">
                  <button className="ob-btn ob-btn--sm" onClick={() => void runOrToast(cancelRequest({ userId: asId(p.userId) }), "Could not cancel")}>
                    Cancel
                  </button>
                </PersonCard>
              ))}
            </div>
          </Section>
        )}

        <Section title="People You May Know">
          {(suggestions ?? []).length === 0 ? (
            <div className="ob-card ob-empty">
              No suggestions right now — when more people join Openbook they'll show up here.
            </div>
          ) : (
            <div className="ob-people-grid">
              {(suggestions ?? []).map((s) => (
                <PersonCard
                  key={s.userId}
                  userId={s.userId}
                  displayName={s.displayName}
                  avatarHue={s.avatarHue}
                  subtitle={s.mutualCount > 0 ? `${s.mutualCount} mutual friend${s.mutualCount === 1 ? "" : "s"}` : undefined}
                >
                  <button className="ob-btn ob-btn--primary ob-btn--sm" onClick={() => void runOrToast(sendRequest({ userId: asId(s.userId) }), "Could not send request")}>
                    Add Friend
                  </button>
                </PersonCard>
              ))}
            </div>
          )}
        </Section>

        <Section title={`All Friends${friends ? ` (${friends.length})` : ""}`}>
          {(friends ?? []).length === 0 ? (
            <div className="ob-card ob-empty">No friends yet. Send a request above!</div>
          ) : (
            <div className="ob-people-grid">
              {(friends ?? []).map((f) => (
                <PersonCard key={f.userId} userId={f.userId} displayName={f.displayName} avatarHue={f.avatarHue}>
                  <button
                    className="ob-btn ob-btn--sm"
                    onClick={() => {
                      if (confirm(`Unfriend ${f.displayName}?`)) void runOrToast(unfriend({ userId: asId(f.userId) }), "Could not unfriend");
                    }}
                  >
                    Unfriend
                  </button>
                </PersonCard>
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
