"use client";

import { useActionState } from "react";
import { Save } from "lucide-react";
import { ActionState, updateEventAction } from "../../actions";

const initialState: ActionState = { ok: false, message: "" };

export function EditEventForm({
  eventId,
  defaultTitle,
  defaultGameSystem,
  defaultDate,
  defaultStartTime,
  defaultEndTime,
  defaultImageUrl,
  defaultDescription,
  defaultTimezone,
}: {
  eventId: string;
  defaultTitle: string;
  defaultGameSystem: string;
  defaultDate: string;
  defaultStartTime: string;
  defaultEndTime: string;
  defaultImageUrl?: string;
  defaultDescription?: string;
  defaultTimezone?: string;
}) {
  const [state, formAction, pending] = useActionState(
    updateEventAction,
    initialState,
  );

  return (
    <details className="section-panel">
      <summary className="section-heading" style={{ cursor: "pointer" }}>
        <div>
          <h2>Edit Event</h2>
          <p className="muted">Update event details and sync to Discord.</p>
        </div>
      </summary>

      <form className="form-grid compact" action={formAction}>
        <input type="hidden" name="eventId" value={eventId} />
        {defaultTimezone ? (
          <input type="hidden" name="timezone" value={defaultTimezone} />
        ) : null}
        <label>
          Event name
          <input
            name="title"
            required
            maxLength={120}
            defaultValue={defaultTitle}
          />
        </label>
        <label>
          Game
          <select name="gameSystem" defaultValue={defaultGameSystem}>
            <option value="D&D">D&amp;D</option>
            <option value="Daggerheart">Daggerheart</option>
            <option value="Board Game">Board Game</option>
          </select>
        </label>
        <label>
          Date
          <input name="date" type="date" required defaultValue={defaultDate} />
        </label>
        <label>
          Starts
          <input
            name="startTime"
            type="time"
            required
            defaultValue={defaultStartTime}
          />
        </label>
        <label>
          Ends
          <input
            name="endTime"
            type="time"
            required
            defaultValue={defaultEndTime}
          />
        </label>
        <label className="span-all">
          Event graphic URL
          <input
            name="imageUrl"
            type="url"
            placeholder="https://example.com/event-poster.png"
            defaultValue={defaultImageUrl ?? ""}
          />
        </label>
        <label className="span-all">
          Description
          <textarea
            name="description"
            maxLength={2000}
            rows={3}
            defaultValue={defaultDescription ?? ""}
          />
        </label>
        <div className="form-actions span-all">
          <button className="button" type="submit" disabled={pending}>
            <Save size={16} />
            {pending ? "Saving" : "Save changes"}
          </button>
          {state.message ? (
            <p className={state.ok ? "form-message ok" : "form-message error"}>
              {state.message}
            </p>
          ) : null}
        </div>
      </form>
    </details>
  );
}
