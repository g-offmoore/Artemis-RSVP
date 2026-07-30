"use client";

import { useActionState, useState } from "react";
import { EventTypeConfig } from "../../../src/lib/artemis-api";
import { updateSeriesEventTypeAction, ActionState } from "../../actions";

const emptyState: ActionState = { ok: false, message: "" };

const BOOL_FIELDS: Array<{ key: keyof EventTypeConfig; label: string; description: string }> = [
  { key: "requiresRsvp", label: "Requires RSVP", description: "Players must RSVP to join" },
  { key: "allowsGuests", label: "Allows guests", description: "Players may bring additional guests" },
  { key: "requiresAmbassadors", label: "Requires ambassadors", description: "Tables need a registered ambassador/DM" },
  { key: "requiresTableAssignment", label: "Table assignment", description: "Run table-assignment algorithm" },
  { key: "usesPlayerCategories", label: "Player categories", description: "Normal/Heroic tier distinction" },
  { key: "createsTemporaryRoles", label: "Temporary Discord roles", description: "Create and assign per-event Discord roles" },
  { key: "requiresAttendanceConfirmation", label: "Attendance confirmation", description: "Collect attendance records after the event" },
  { key: "sendsFeedbackPrompts", label: "Feedback prompts", description: "Send post-event feedback requests" },
  { key: "usesWaitlist", label: "Waitlist", description: "Allow waitlisting when tables are full" },
  { key: "allowsNameOnlyWalkIns", label: "Name-only walk-ins", description: "Accept walk-ins without a Discord account" },
] as const;

export function SeriesSignupOptionsPanel({
  seriesId,
  current,
}: {
  seriesId: string;
  current: EventTypeConfig;
}) {
  const [expanded, setExpanded] = useState(false);
  const [state, action, pending] = useActionState(updateSeriesEventTypeAction, emptyState);

  const summary = [
    current.requiresRsvp ? "RSVP" : null,
    current.allowsGuests ? `guests (max ${current.maxGuestsPerRsvp})` : "no guests",
    current.usesWaitlist ? "waitlist" : null,
    current.requiresAmbassadors ? "ambassadors" : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <section className="section-panel" aria-labelledby="signup-options-heading">
      <div className="section-heading">
        <div>
          <h2 id="signup-options-heading" style={{ margin: 0 }}>Series Signup Options</h2>
          <p className="muted">
            These defaults are copied into each new occurrence at generation time.
            Editing here does not affect already-generated events.
          </p>
        </div>
        <button
          className="button secondary"
          type="button"
          onClick={() => setExpanded((e) => !e)}
          style={{ fontSize: "0.8rem" }}
        >
          {expanded ? "Collapse" : "Edit"}
        </button>
      </div>

      {!expanded && (
        <p className="muted" style={{ margin: 0 }}>
          <strong>{current.name}</strong> &mdash; {summary || "default settings"}
        </p>
      )}

      {expanded && (
        <form action={action} style={{ marginTop: "1rem" }}>
          <input type="hidden" name="seriesId" value={seriesId} />
          <input type="hidden" name="_signupOptionsSubmitted" value="1" />

          <div className="field" style={{ marginBottom: "1rem" }}>
            <label>
              Signup profile name
              <input
                name="eventTypeName"
                defaultValue={current.name}
                maxLength={120}
                placeholder="D&D Session Night"
                style={{ marginTop: "0.25rem" }}
              />
            </label>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(18rem, 1fr))", gap: "0.5rem 1.5rem", marginBottom: "1rem" }}>
            {BOOL_FIELDS.map(({ key, label, description }) => (
              <label key={key} style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start", fontSize: "0.875rem" }}>
                <input
                  type="checkbox"
                  name={key}
                  value="true"
                  defaultChecked={current[key] as boolean}
                  style={{ marginTop: "0.1rem", flexShrink: 0 }}
                />
                <span>
                  {label}
                  <span className="muted" style={{ display: "block", fontSize: "0.8rem" }}>{description}</span>
                </span>
              </label>
            ))}
          </div>

          <div className="field" style={{ marginBottom: "1rem" }}>
            <label>
              Max guests per RSVP
              <input
                name="maxGuestsPerRsvp"
                type="number"
                min={0}
                max={20}
                defaultValue={current.maxGuestsPerRsvp}
                style={{ width: "6rem", marginLeft: "0.75rem" }}
              />
            </label>
          </div>

          {state.message && (
            <p className={state.ok ? "success" : "error"} style={{ margin: "0.5rem 0" }}>
              {state.message}
            </p>
          )}
          <button type="submit" disabled={pending} className="button secondary">
            {pending ? "Saving…" : "Save series signup options"}
          </button>
        </form>
      )}
    </section>
  );
}
