"use client";

import { useActionState, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarPlus } from "lucide-react";
import { ActionState, createEventAction } from "./actions";

const initialState: ActionState = { ok: false, message: "" };

export function EventCreateForm({
  defaultChannelId,
  defaultTimezone,
  guildDefaultChannelId,
  seriesDefaultChannelId,
}: {
  defaultChannelId?: string;
  defaultTimezone?: string;
  guildDefaultChannelId?: string;
  seriesDefaultChannelId?: string;
}) {
  const [state, formAction, pending] = useActionState(
    createEventAction,
    initialState,
  );
  const searchParams = useSearchParams();
  const prefilledDate = searchParams.get("createDate") ?? undefined;

  const [imagePreviewUrl, setImagePreviewUrl] = useState("");
  const [manualChannelId, setManualChannelId] = useState(defaultChannelId ?? "");
  const resolvedChannelId = useMemo(() => manualChannelId || seriesDefaultChannelId || guildDefaultChannelId || "", [guildDefaultChannelId, manualChannelId, seriesDefaultChannelId]);

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
        <input type="hidden" name="guildDefaultChannelId" value={guildDefaultChannelId ?? ""} />
        <input type="hidden" name="seriesDefaultChannelId" value={seriesDefaultChannelId ?? ""} />
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
          Timezone
          <select name="timezone" defaultValue={defaultTimezone ?? "America/New_York"}>
            <option value="America/New_York">America/New_York</option>
            <option value="America/Chicago">America/Chicago</option>
            <option value="America/Denver">America/Denver</option>
            <option value="America/Los_Angeles">America/Los_Angeles</option>
            <option value="UTC">UTC</option>
          </select>
        </label>
        <label>
          Event type
          <select name="eventType" defaultValue="ONE_SHOT">
            <option value="ONE_SHOT">One-shot</option>
            <option value="SERIES_OCCURRENCE">Series occurrence</option>
          </select>
        </label>
        <label>
          Event status
          <select name="status" defaultValue="DRAFT">
            <option value="DRAFT">Draft</option>
            <option value="SCHEDULED">Scheduled</option>
          </select>
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
          <input name="date" type="date" required defaultValue={prefilledDate} />
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
            onChange={(e) => setManualChannelId(e.target.value.trim())}
            pattern="^\d{17,20}$"
            title="Discord channel IDs are numeric and usually 17–20 digits."
            placeholder="123456789012345678"
          />
          <small className="muted">Leave empty to inherit series or guild default channel.</small>
        </label>
        <label className="span-all">
          Event graphic URL
          <input
            name="imageUrl"
            type="url"
            placeholder="https://example.com/event-poster.png"
            onChange={(e) => setImagePreviewUrl(e.target.value.trim())}
          />
          {imagePreviewUrl ? <img className="event-graphic" src={imagePreviewUrl} alt="Graphic preview" /> : null}
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
          <p className="muted">Will post to #{resolvedChannelId || "(none)"} / {resolvedChannelId || "no-channel"}</p>
          <button className="button secondary" type="button" onClick={() => alert(`Preview\nTitle: ${String((document.querySelector(`input[name=title]`) as HTMLInputElement)?.value || "") }\nChannel: ${resolvedChannelId || "(none)"}`)}>Test publish preview</button>
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
