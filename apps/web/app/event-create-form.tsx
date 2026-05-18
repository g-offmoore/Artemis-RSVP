"use client";

import { useActionState } from "react";
import { CalendarPlus } from "lucide-react";
import { ActionState, createEventAction } from "./actions";

const initialState: ActionState = { ok: false, message: "" };

export function EventCreateForm({
  defaultChannelId,
  defaultTimezone,
}: {
  defaultChannelId?: string;
  defaultTimezone?: string;
}) {
  const [state, formAction, pending] = useActionState(
    createEventAction,
    initialState,
  );

  return (
    <section className="section-panel" aria-labelledby="create-event-heading">
      <div className="section-heading">
        <div>
          <h2 id="create-event-heading">Create Event</h2>
          <p className="muted">
            Create the event record and start tracking signups.
          </p>
        </div>
      </div>

      <form className="form-grid" action={formAction}>
        {defaultTimezone ? (
          <input type="hidden" name="timezone" value={defaultTimezone} />
        ) : null}
        <label>
          Event name
          <input
            name="title"
            required
            maxLength={120}
            placeholder="D&D Thursday Night"
          />
        </label>
        <label>
          Game
          <select name="gameSystem" defaultValue="D&D">
            <option value="D&D">D&amp;D</option>
            <option value="Daggerheart">Daggerheart</option>
            <option value="Board Game">Board Game</option>
          </select>
        </label>
        <label>
          Date
          <input name="date" type="date" required />
        </label>
        <label>
          Starts
          <input name="startTime" type="time" required />
        </label>
        <label>
          Ends
          <input name="endTime" type="time" required />
        </label>
        <label>
          Discord channel ID
          <input
            name="channelId"
            defaultValue={defaultChannelId}
            required={!defaultChannelId}
          />
        </label>
        <label className="span-all">
          Event graphic URL
          <input
            name="imageUrl"
            type="url"
            placeholder="https://example.com/event-poster.png"
          />
        </label>
        <label className="span-all">
          Description
          <textarea name="description" maxLength={2000} rows={3} />
        </label>
        <div className="form-actions span-all">
          <button className="button" type="submit" disabled={pending}>
            <CalendarPlus size={16} />
            {pending ? "Creating" : "Create event"}
          </button>
          {state.message ? (
            <p className={state.ok ? "form-message ok" : "form-message error"}>
              {state.message}
            </p>
          ) : null}
        </div>
      </form>
    </section>
  );
}
