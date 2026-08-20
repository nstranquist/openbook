import { api } from "@openbook/shared";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { runOrToast } from "../lib/run";

export function EventsPage() {
  const events = useQuery(api.events.upcoming) ?? [];
  const create = useMutation(api.events.create);
  const rsvp = useMutation(api.events.rsvp);
  const cancel = useMutation(api.events.cancel);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startLocal, setStartLocal] = useState("");
  return (
    <div className="ob-stack" style={{ maxWidth: 680, margin: "16px auto" }}>
      <h1>Events</h1>
      <div className="ob-card ob-stack" style={{ gap: 8 }}>
        <input className="g-input" placeholder="Event title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea className="g-textarea" placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
        <input
          className="g-input"
          type="datetime-local"
          value={startLocal}
          onChange={(e) => setStartLocal(e.target.value)}
          aria-label="Start time"
        />
        <button
          className="ob-btn ob-btn--primary"
          onClick={() => {
            const startAt = startLocal ? new Date(startLocal).getTime() : Date.now() + 86400000;
            void runOrToast(
              create({ title, description, startAt }),
              "Could not create",
            ).then(() => {
              setTitle("");
              setDescription("");
              setStartLocal("");
            });
          }}
        >
          Create
        </button>
      </div>
      {events.map((e) => (
        <div key={e._id} className="ob-card">
          <div className="ob-bold">{e.title}</div>
          <div className="ob-muted ob-small">
            {new Date(e.startAt).toLocaleString()} · {e.host.displayName}
            {e.description ? ` · ${e.description}` : ""}
          </div>
          <div className="ob-muted ob-small">{e.going} going · {e.interested} interested</div>
          <div className="ob-row" style={{ gap: 8, marginTop: 8 }}>
            <button
              className={`ob-btn ob-btn--sm${e.myRsvp === "going" ? " ob-btn--primary" : ""}`}
              onClick={() => void runOrToast(rsvp({ eventId: e._id, status: "going" }), "Could not RSVP")}
            >
              Going
            </button>
            <button
              className={`ob-btn ob-btn--sm${e.myRsvp === "interested" ? " ob-btn--primary" : ""}`}
              onClick={() => void runOrToast(rsvp({ eventId: e._id, status: "interested" }), "Could not RSVP")}
            >
              Interested
            </button>
            {e.isHost && (
              <button className="ob-btn ob-btn--sm" onClick={() => void runOrToast(cancel({ eventId: e._id }), "Could not cancel")}>
                Cancel event
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
