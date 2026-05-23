"use client";

import { useActionState, useMemo, useState } from "react";
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
  seriesId,
  defaultChannelId,
  guildDefaultChannelId,
  seriesDefaultChannelId,
  defaultStatus,
  defaultEventType,
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
  seriesId?: string | null;
  defaultChannelId?: string;
  guildDefaultChannelId?: string;
  seriesDefaultChannelId?: string;
  defaultStatus?: string;
  defaultEventType?: string;
}) {
  const [state, formAction, pending] = useActionState(
    updateEventAction,
    initialState,
  );
  const [manualChannelId, setManualChannelId] = useState(defaultChannelId ?? "");
  const [imagePreviewUrl, setImagePreviewUrl] = useState(defaultImageUrl ?? "");
  const resolvedChannelId = useMemo(() => manualChannelId || seriesDefaultChannelId || guildDefaultChannelId || "", [guildDefaultChannelId, manualChannelId, seriesDefaultChannelId]);

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
            defaultValue={defaultTitle}
          />
        </label>
        <label>
          Timezone
          <select name="timezone" defaultValue={defaultTimezone ?? "America/New_York"}><option value="America/New_York">America/New_York</option><option value="America/Chicago">America/Chicago</option><option value="America/Denver">America/Denver</option><option value="America/Los_Angeles">America/Los_Angeles</option><option value="UTC">UTC</option></select>
        </label>
        <label>Event type<select name="eventType" defaultValue={defaultEventType ?? "ONE_SHOT"}><option value="ONE_SHOT">One-shot</option><option value="SERIES_OCCURRENCE">Series occurrence</option></select></label>
        <label>Event status<select name="status" defaultValue={defaultStatus ?? "SCHEDULED"}><option value="DRAFT">Draft</option><option value="SCHEDULED">Scheduled</option><option value="CANCELLED">Cancelled</option></select></label>
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
          Channel ID
          <input name="channelId" defaultValue={defaultChannelId ?? ""} onChange={(e) => setManualChannelId(e.target.value.trim())} pattern="^\d{17,20}$" title="Discord channel IDs are numeric and usually 17–20 digits." placeholder="123456789012345678" />
          <small className="muted">Leave empty to inherit series or guild default channel.</small>
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
            onChange={(e) => setImagePreviewUrl(e.target.value.trim())}
          />
        {imagePreviewUrl ? <img className="event-graphic" src={imagePreviewUrl} alt="Graphic preview" /> : null}
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
        {seriesId ? (
          <fieldset className="span-all" style={{ border: "1px solid var(--border, #333)", borderRadius: "4px", padding: "0.75rem" }}>
            <legend style={{ padding: "0 0.25rem", fontSize: "0.85rem" }}>Apply changes to</legend>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem", fontWeight: "normal" }}>
              <input type="radio" name="applyToFuture" value="false" defaultChecked />
              This event only
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontWeight: "normal" }}>
              <input type="radio" name="applyToFuture" value="true" />
              This and all future events in the series
            </label>
          </fieldset>
        ) : null}
        <div className="form-actions span-all">
          <button className="button" type="submit" disabled={pending}>
            <Save size={16} />
            {pending ? "Saving" : "Save changes"}
          </button>
          <p className="muted">Will post to #{resolvedChannelId || "(none)"} / {resolvedChannelId || "no-channel"}</p>
          <button className="button secondary" type="button" onClick={() => alert(`Preview\nChannel: ${resolvedChannelId || "(none)"}`)}>Test publish preview</button>
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
