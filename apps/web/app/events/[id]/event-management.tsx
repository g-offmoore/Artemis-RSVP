"use client";

import { useActionState } from "react";
import { Megaphone, Play, Plus, XCircle } from "lucide-react";
import {
  ActionState,
  cancelEventAction,
  createTableAction,
  publishDiscordPostAction,
  runAssignmentsAction,
} from "../../actions";

const initialState: ActionState = { ok: false, message: "" };

export function EventManagement({
  eventId,
  gameSystem,
  messageId,
  status,
}: {
  eventId: string;
  gameSystem: string;
  messageId?: string;
  status: string;
}) {
  const [assignmentState, assignmentAction, assignmentPending] = useActionState(
    runAssignmentsAction,
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
  const vocabulary = eventVocabulary(gameSystem);

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
        <form action={publishAction}>
          <input type="hidden" name="eventId" value={eventId} />
          <button
            className="button secondary"
            type="submit"
            disabled={publishPending || status === "CANCELLED"}
          >
            <Megaphone size={16} />
            {publishPending
              ? "Publishing"
              : messageId
                ? "Refresh Discord post"
                : "Publish Discord post"}
          </button>
        </form>
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
      {publishState.message ? (
        <p
          className={publishState.ok ? "form-message ok" : "form-message error"}
        >
          {publishState.message}
        </p>
      ) : null}

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
