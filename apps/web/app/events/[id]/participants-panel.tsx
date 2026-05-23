"use client";

import { useActionState } from "react";
import { removeRsvpAction, ActionState } from "../../actions";

const emptyState: ActionState = { ok: false, message: "" };

type Participant = {
  id: string;
  displayName: string;
  participantType: string;
  playerCategory: string;
  confirmationStatus: string;
  signupRole?: string;
  backupDmStatus?: string;
  discordUserId?: string;
};

type Assignment = {
  id: string;
  eventParticipantId: string;
  eventTableId?: string;
  status: string;
  locked: boolean;
};

type Table = { id: string; title: string };

function RemoveRsvpButton({
  eventId,
  discordUserId,
  displayName,
}: {
  eventId: string;
  discordUserId: string;
  displayName: string;
}) {
  const [state, action, pending] = useActionState(removeRsvpAction, emptyState);

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(`Remove ${displayName}'s RSVP?`)) e.preventDefault();
      }}
      style={{ display: "inline" }}
    >
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="discordUserId" value={discordUserId} />
      <button
        type="submit"
        disabled={pending}
        className="button danger"
        style={{ padding: "0.2rem 0.5rem", fontSize: "0.75rem" }}
        title={state.message || undefined}
      >
        {pending ? "…" : "Remove"}
      </button>
    </form>
  );
}

export function ParticipantsPanel({
  eventId,
  participants,
  assignments,
  tables,
}: {
  eventId: string;
  participants: Participant[];
  assignments: Assignment[];
  tables: Table[];
}) {
  const seatedStatuses = ["ASSIGNED", "PROJECTED_SEATED", "CONFIRMED_SEATED"];

  return (
    <>
      <h2>Participants</h2>
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Category</th>
            <th>Role</th>
            <th>Attendance</th>
            <th>Assignment</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {participants.map((participant) => {
            const assignment = assignments.find(
              (item) =>
                item.eventParticipantId === participant.id &&
                seatedStatuses.includes(item.status),
            );
            const table = tables.find((item) => item.id === assignment?.eventTableId);
            const assignmentLabel = assignment
              ? table?.title
                ? `${table.title}${assignment.status.startsWith("PROJECTED") ? " (projected)" : ""}`
                : assignment.status
              : "Unassigned";
            return (
              <tr key={participant.id}>
                <td>{participant.displayName}</td>
                <td>{participant.playerCategory}</td>
                <td>{participant.signupRole ?? "PLAYER"}</td>
                <td>{participant.confirmationStatus}</td>
                <td>{assignmentLabel}</td>
                <td>
                  {participant.discordUserId ? (
                    <RemoveRsvpButton
                      eventId={eventId}
                      discordUserId={participant.discordUserId}
                      displayName={participant.displayName}
                    />
                  ) : null}
                </td>
              </tr>
            );
          })}
          {participants.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">No participants.</td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
