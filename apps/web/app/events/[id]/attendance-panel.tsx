"use client";

import { useActionState, useState } from "react";
import { confirmAttendanceAction, ActionState } from "../../actions";

const emptyState: ActionState = { ok: false, message: "" };

const ATTENDANCE_STATUSES = ["ATTENDED", "NO_SHOW", "EXCUSED", "WALK_IN", "UNKNOWN"] as const;

type Participant = {
  id: string;
  displayName: string;
  signupRole?: string;
  confirmationStatus: string;
};

export function AttendancePanel({
  eventId,
  participants,
  isLocked,
}: {
  eventId: string;
  participants: Participant[];
  isLocked: boolean;
}) {
  const [state, action, pending] = useActionState(confirmAttendanceAction, emptyState);
  const [expanded, setExpanded] = useState(false);

  if (!isLocked) return null;

  return (
    <section>
      <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1rem" }}>
        <h2 style={{ margin: 0 }}>Attendance</h2>
        <button
          className="button secondary"
          type="button"
          onClick={() => setExpanded((e) => !e)}
          style={{ fontSize: "0.8rem" }}
        >
          {expanded ? "Collapse" : "Mark attendance"}
        </button>
      </div>
      {expanded && (
        <form action={action}>
          <input type="hidden" name="eventId" value={eventId} />
          <table className="table">
            <thead>
              <tr>
                <th>Participant</th>
                <th>Role</th>
                <th>Status</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {participants.map((p) => (
                <tr key={p.id}>
                  <td>
                    <input type="hidden" name="participantId" value={p.id} />
                    {p.displayName}
                  </td>
                  <td>{p.signupRole ?? "PLAYER"}</td>
                  <td>
                    <select
                      name={`status_${p.id}`}
                      defaultValue={
                        p.confirmationStatus === "ATTENDED" ||
                        p.confirmationStatus === "NO_SHOW" ||
                        p.confirmationStatus === "EXCUSED" ||
                        p.confirmationStatus === "WALK_IN"
                          ? p.confirmationStatus
                          : "ATTENDED"
                      }
                    >
                      {ATTENDANCE_STATUSES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      name={`notes_${p.id}`}
                      placeholder="Optional note"
                      style={{ width: "100%" }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {state.message && (
            <p className={state.ok ? "success" : "error"}>{state.message}</p>
          )}
          <button type="submit" disabled={pending} className="button" style={{ marginTop: "0.75rem" }}>
            {pending ? "Saving…" : "Save Attendance"}
          </button>
        </form>
      )}
    </section>
  );
}
