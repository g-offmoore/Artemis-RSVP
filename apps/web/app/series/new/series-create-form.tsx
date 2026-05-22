"use client";

import { useActionState } from "react";
import { CalendarRange } from "lucide-react";
import { ActionState, createSeriesAction } from "../../actions";

const initialState: ActionState = { ok: false, message: "" };

const WEEKDAYS = [
  { value: "MON", label: "Monday" },
  { value: "TUE", label: "Tuesday" },
  { value: "WED", label: "Wednesday" },
  { value: "THU", label: "Thursday" },
  { value: "FRI", label: "Friday" },
  { value: "SAT", label: "Saturday" },
  { value: "SUN", label: "Sunday" },
];

export function SeriesCreateForm({
  defaultChannelId,
}: {
  defaultChannelId?: string;
}) {
  const [state, formAction, pending] = useActionState(createSeriesAction, initialState);

  return (
    <section className="section-panel" aria-labelledby="create-series-heading">
      <div className="section-heading">
        <div>
          <h2 id="create-series-heading">Create Weekly Series</h2>
          <p className="muted">
            Define a template for recurring events. Generate occurrences after creation.
          </p>
        </div>
      </div>

      <form className="form-grid" action={formAction}>
        <label>
          Series name
          <input
            name="name"
            required
            maxLength={120}
            placeholder="Friday Night D&amp;D"
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
          Recurring weekday
          <select name="weekday" defaultValue="FRI">
            {WEEKDAYS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Start hour (0–23)
          <input name="startHour" type="number" min={0} max={23} defaultValue={18} required />
        </label>
        <label>
          Start minute
          <select name="startMinute" defaultValue="0">
            <option value="0">:00</option>
            <option value="15">:15</option>
            <option value="30">:30</option>
            <option value="45">:45</option>
          </select>
        </label>
        <label>
          Duration (minutes)
          <input name="durationMinutes" type="number" min={30} max={720} defaultValue={240} required />
        </label>
        <label>
          Discord channel ID
          <input
            name="defaultChannelId"
            defaultValue={defaultChannelId}
            required={!defaultChannelId}
            placeholder={defaultChannelId ? undefined : "Required"}
          />
        </label>
        <div className="form-actions span-all">
          <button className="button" type="submit" disabled={pending}>
            <CalendarRange size={16} />
            {pending ? "Creating" : "Create series"}
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
