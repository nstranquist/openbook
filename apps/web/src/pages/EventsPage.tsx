import { api } from "@openbook/shared";
import { useMutation, useQuery } from "convex/react";
import { type FormEvent, useState } from "react";
import { Field } from "../components/Field";
import { runOrToast } from "../lib/run";

export function EventsPage() {
  const events = useQuery(api.events.upcoming) ?? [];
  const create = useMutation(api.events.create);
  const rsvp = useMutation(api.events.rsvp);
  const cancel = useMutation(api.events.cancel);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startLocal, setStartLocal] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    const startAt = new Date(startLocal).getTime();
    void runOrToast(
      create({ title, description, startAt }),
      "Could not create",
    ).then((id) => {
      if (!id) return;
      setTitle("");
      setDescription("");
      setStartLocal("");
    });
  }
  return (
    <div className="ob-stack" style={{ maxWidth: 680, margin: "16px auto" }}>
      <h1>Events</h1>
      <form className="ob-card ob-stack ob-form" aria-labelledby="create-event-title" onSubmit={submit}>
        <h2 id="create-event-title" className="ob-form-title">Create an event</h2>
        <Field label="Event title">
          <input
            className="g-input"
            name="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            required
          />
        </Field>
        <Field label="Description" hint="Optional. Add up to 1,000 characters.">
          <textarea
            className="g-textarea"
            name="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={1000}
          />
        </Field>
        <Field label="Start time">
          <input
            className="g-input"
            name="startAt"
            type="datetime-local"
            value={startLocal}
            onChange={(e) => setStartLocal(e.target.value)}
            required
          />
        </Field>
        <button type="submit" className="ob-btn ob-btn--primary">Create event</button>
      </form>
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
