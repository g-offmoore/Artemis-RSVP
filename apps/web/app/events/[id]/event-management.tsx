"use client";

import { useActionState } from "react";
import { AlertTriangle, Lock, Megaphone, Play, Plus, RefreshCw, XCircle } from "lucide-react";
import {
  ActionState,
  cancelEventAction,
  createTableAction,
  lockAssignmentsAction,
  publishDiscordPostAction,
  retryEventRoleAction,
  runAssignmentsAction,
} from "../../actions";

const initialState: ActionState = { ok: false, message: "" };

type EventRole = {
  id: string;
  roleType: string;
  name: string;
  discordRoleId?: string | null;
  failedAt?: string | null;
  lastError?: string | null;
  expiresAt: string;
  deletedAt?: string | null;
};

export function EventManagement({
  eventId,
  gameSystem,
  messageId,
  status,
  assignmentLockedAt,
  roles,
}: {
  eventId: string;
  gameSystem: string;
  messageId?: string;
  status: string;
  assignmentLockedAt?: string;
  roles?: EventRole[];
}) {
  const [assignmentState, assignmentAction, assignmentPending] = useActionState(
    runAssignmentsAction,
    initialState,
  );
  const [lockState, lockAction, lockPending] = useActionState(
    lockAssignmentsAction,
    initialState,
  );
  const [cancelState, cancelAction, cancelPending] = useActionState(
    cancelEventAction,
    initialState,
  );
  const [tableState, tableAction, tablePending] = useActionState(
    createTableAction,
    initialState,
  );
  const [publishState, publishAction, publishPending] = useActionState(
    publishDiscordPostAction,
    initialState,
  );
  const [roleRetryState, roleRetryAction, roleRetryPending] = useActionState(
    retryEventRoleAction,
    initialState,
  );
  const vocabulary = eventVocabulary(gameSystem);
  const playerRole = roles?.find((r) => r.roleType === "PLAYER");
  const roleFailed = playerRole && !playerRole.discordRoleId && playerRole.failedAt;
  const rolePending = playerRole && !playerRole.discordRoleId && !playerRole.failedAt;
  const roleExpired = playerRole?.deletedAt;
  const isLocked = Boolean(assignmentLockedAt);

  return (
    <section className="section-panel" aria-labelledby="manage-event-heading">
      <div className="section-heading">
        <div>
          <h2 id="manage-event-heading">Manage Event</h2>
          <p className="muted">
            Update table coverage and assignment state without leaving the
            dashboard.
          </p>
        </div>
        <form action={assignmentAction}>
          <input type="hidden" name="eventId" value={eventId} />
          <button
            className="button secondary"
            type="submit"
            disabled={assignmentPending || status === "CANCELLED"}
          >
            <Play size={16} />
            {assignmentPending ? "Running" : "Run assignments"}
          </button>
        </form>
        <form
          action={lockAction}
          onSubmit={(e) => {
            if (isLocked) { e.preventDefault(); return; }
            if (!window.confirm(
              "Lock final assignments for this event? This will confirm projected seating. After lock, changes should be organizer-only emergency changes."
            )) e.preventDefault();
          }}
        >
          <input type="hidden" name="eventId" value={eventId} />
          <button
            className="button secondary"
            type="submit"
            disabled={lockPending || isLocked || status === "CANCELLED"}
            title={isLocked ? `Locked ${new Date(assignmentLockedAt!).toLocaleString()}` : undefined}
          >
            <Lock size={16} />
            {lockPending ? "Locking…" : isLocked ? "Assignments locked" : "Lock assignments"}
          </button>
        </form>
        {messageId ? (
          <form action={publishAction}>
            <input type="hidden" name="eventId" value={eventId} />
            <button
              className="button secondary"
              type="submit"
              disabled={publishPending || status === "CANCELLED"}
              title="Update the existing Discord post with the latest event data"
            >
              <RefreshCw size={16} />
              {publishPending ? "Syncing…" : "Sync Discord post"}
            </button>
          </form>
        ) : (
          <form action={publishAction}>
            <input type="hidden" name="eventId" value={eventId} />
            <button
              className="button secondary"
              type="submit"
              disabled={publishPending || status === "CANCELLED"}
            >
              <Megaphone size={16} />
              {publishPending ? "Publishing…" : "Publish Discord post"}
            </button>
          </form>
        )}
      </div>

      {assignmentState.message ? (
        <p
          className={
            assignmentState.ok ? "form-message ok" : "form-message error"
          }
        >
          {assignmentState.message}
        </p>
      ) : null}
      {lockState.message ? (
        <p className={lockState.ok ? "form-message ok" : "form-message error"}>
          {lockState.message}
        </p>
      ) : null}
      {publishState.message ? (
        <p
          className={publishState.ok ? "form-message ok" : "form-message error"}
        >
          {publishState.message}
        </p>
      ) : null}

      {roleFailed && (
        <div className="role-failure-panel">
          <p className="form-message error">
            <AlertTriangle size={14} style={{ display: "inline", verticalAlign: "middle", marginRight: "0.3rem" }} />
            <strong>Discord event role creation failed.</strong>{" "}
            {playerRole.lastError ?? "Unknown error."}
          </p>
          <form action={roleRetryAction} style={{ marginTop: "0.5rem" }}>
            <input type="hidden" name="eventId" value={eventId} />
            <button
              className="button secondary"
              type="submit"
              disabled={roleRetryPending}
            >
              <RefreshCw size={14} />
              {roleRetryPending ? "Retrying…" : "Retry role creation"}
            </button>
            {roleRetryState.message ? (
              <p className={roleRetryState.ok ? "form-message ok" : "form-message error"}>
                {roleRetryState.message}
              </p>
            ) : null}
          </form>
        </div>
      )}
      {rolePending && !roleFailed && (
        <p className="form-message" style={{ color: "var(--color-muted, #888)" }}>
          Discord event role: pending creation…
        </p>
      )}
      {roleExpired && (
        <p className="form-message" style={{ color: "var(--color-muted, #888)" }}>
          Discord event role expired and cleaned up.
        </p>
      )}

      <form className="form-grid compact" action={tableAction}>
        <input type="hidden" name="eventId" value={eventId} />
        <input type="hidden" name="gameSystem" value={gameSystem} />
        <label>
          Table title
          <input
            name="title"
            maxLength={120}
            placeholder={`${vocabulary.hostSingular}'s Table`}
          />
        </label>
        {vocabulary.usesDndCategories ? (
          <label>
            Type
            <select name="tableType" defaultValue="MIXED">
              <option value="NORMAL">Normal</option>
              <option value="HEROIC">Heroic</option>
              <option value="MIXED">Mixed</option>
            </select>
          </label>
        ) : (
          <input type="hidden" name="tableType" value="MIXED" />
        )}
        <label>
          Soft cap
          <input
            name="softCap"
            type="number"
            min={1}
            max={20}
            defaultValue={6}
          />
        </label>
        <label>
          Hard cap
          <input
            name="hardCap"
            type="number"
            min={1}
            max={20}
            defaultValue={7}
          />
        </label>
        <div className="form-actions span-all">
          <button
            className="button"
            type="submit"
            disabled={tablePending || status === "CANCELLED"}
          >
            <Plus size={16} />
            {tablePending
              ? "Registering"
              : `Register ${vocabulary.hostSingular} table`}
          </button>
          {tableState.message ? (
            <p
              className={
                tableState.ok ? "form-message ok" : "form-message error"
              }
            >
              {tableState.message}
            </p>
          ) : null}
        </div>
      </form>

      <form
        className="danger-row"
        action={cancelAction}
        onSubmit={(event) => {
          if (!window.confirm("Cancel this event?")) event.preventDefault();
        }}
      >
        <input type="hidden" name="eventId" value={eventId} />
        <button
          className="button danger"
          type="submit"
          disabled={cancelPending || status === "CANCELLED"}
        >
          <XCircle size={16} />
          {cancelPending ? "Cancelling" : "Cancel event"}
        </button>
        {cancelState.message ? (
          <p
            className={
              cancelState.ok ? "form-message ok" : "form-message error"
            }
          >
            {cancelState.message}
          </p>
        ) : null}
      </form>
    </section>
  );
}

function eventVocabulary(gameSystem: string) {
  const value = gameSystem.trim().toLowerCase();
  if (value === "d&d" || value === "dnd" || value.includes("dungeons")) {
    return { usesDndCategories: true, hostSingular: "DM" };
  }
  if (value === "daggerheart") {
    return { usesDndCategories: false, hostSingular: "GM" };
  }
  return { usesDndCategories: false, hostSingular: "Ambassador" };
}
