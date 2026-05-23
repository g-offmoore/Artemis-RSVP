"use client";

import { useActionState, useMemo, useState } from "react";
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
  defaultTimezone,
}: {
  defaultChannelId?: string;
  defaultTimezone?: string;
}) {
  const [state, formAction, pending] = useActionState(
    createSeriesAction,
    initialState,
  );
  const [weekday, setWeekday] = useState("FRI");
  const [startHour, setStartHour] = useState(18);
  const [startMinute, setStartMinute] = useState(0);
  const [durationMinutes, setDurationMinutes] = useState(240);

  const recurrenceSummary = useMemo(() => {
    const dayLabel =
      WEEKDAYS.find((d) => d.value === weekday)?.label ?? weekday;
    const hours = Math.floor(durationMinutes / 60);
    const minutes = durationMinutes % 60;
    const formattedHour = startHour % 12 === 0 ? 12 : startHour % 12;
    const ampm = startHour < 12 ? "AM" : "PM";
    const durationLabel = `${hours}h${minutes ? ` ${minutes}m` : ""}`;
    return `Every ${dayLabel} at ${formattedHour}:${String(startMinute).padStart(2, "0")} ${ampm} for ${durationLabel}`;
  }, [durationMinutes, startHour, startMinute, weekday]);

  return (
    <section className="section-panel" aria-labelledby="create-series-heading">
      <div className="section-heading">
        <div>
          <h2 id="create-series-heading">Create Weekly Series</h2>
          <p className="muted">
            Define a template for recurring events. Generate occurrences after
            creation.
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
          <select
            name="weekday"
            value={weekday}
            onChange={(event) => setWeekday(event.target.value)}
          >
            {WEEKDAYS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Timezone
          <input
            name="timezone"
            defaultValue={defaultTimezone ?? "America/New_York"}
            required
            placeholder="America/New_York"
          />
        </label>
        <label>
          Default start hour (0–23)
          <input
            name="startHour"
            type="number"
            min={0}
            max={23}
            value={startHour}
            onChange={(event) => setStartHour(Number(event.target.value))}
            required
          />
        </label>
        <label>
          Default start minute
          <select
            name="startMinute"
            value={String(startMinute)}
            onChange={(event) => setStartMinute(Number(event.target.value))}
          >
            <option value="0">:00</option>
            <option value="15">:15</option>
            <option value="30">:30</option>
            <option value="45">:45</option>
          </select>
        </label>
        <label>
          Default duration (minutes)
          <input
            name="durationMinutes"
            type="number"
            min={30}
            max={720}
            value={durationMinutes}
            onChange={(event) => setDurationMinutes(Number(event.target.value))}
            required
          />
        </label>
        <label>
          Default channel
          <input
            name="defaultChannelId"
            defaultValue={defaultChannelId}
            required={!defaultChannelId}
            placeholder={defaultChannelId ? undefined : "Required"}
          />
        </label>
        <label>
          Recurrence rule summary preview
          <input readOnly value={recurrenceSummary} aria-readonly="true" />
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
