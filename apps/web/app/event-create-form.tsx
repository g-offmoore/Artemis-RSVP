"use client";

import { useActionState, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarPlus, CalendarRange } from "lucide-react";
import { ActionState, createEventAction, createRecurringEventAction } from "./actions";
import { GuildSummary, ChannelSummary } from "../src/lib/artemis-api";

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

export function EventCreateForm({
  defaultGuildId,
  defaultChannelId,
  defaultTimezone,
  authorizedGuilds,
}: {
  defaultGuildId?: string;
  defaultChannelId?: string;
  defaultTimezone?: string;
  authorizedGuilds?: GuildSummary[];
}) {
  const [isRecurring, setIsRecurring] = useState(false);
  const [selectedGuildId, setSelectedGuildId] = useState(defaultGuildId ?? "");
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [selectedChannelId, setSelectedChannelId] = useState(defaultChannelId ?? "");
  const [signupOptionsExpanded, setSignupOptionsExpanded] = useState(false);

  const [oneOffState, oneOffAction, oneOffPending] = useActionState(createEventAction, initialState);
  const [recurringState, recurringAction, recurringPending] = useActionState(createRecurringEventAction, initialState);

  const searchParams = useSearchParams();
  const prefilledDate = searchParams.get("createDate") ?? undefined;

  // Fetch channels from the auth-gated route handler when the guild changes.
  useEffect(() => {
    if (!selectedGuildId) {
      setChannels([]);
      return;
    }
    setChannelsLoading(true);
    fetch(`/api/guilds/${encodeURIComponent(selectedGuildId)}/channels`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: ChannelSummary[]) => {
        setChannels(data);
        // If the guild changed, clear channel selection unless it's still valid.
        setSelectedChannelId((prev) => (data.some((c) => c.id === prev) ? prev : (data[0]?.id ?? "")));
      })
      .catch(() => setChannels([]))
      .finally(() => setChannelsLoading(false));
  }, [selectedGuildId]);

  const pending = oneOffPending || recurringPending;
  const state = isRecurring ? recurringState : oneOffState;
  const formAction = isRecurring ? recurringAction : oneOffAction;

  const hasGuilds = authorizedGuilds && authorizedGuilds.length > 1;

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

        {/* Guild picker — always send guildId so the action can validate it server-side */}
        {hasGuilds ? (
          <label>
            Server
            <select
              name="guildId"
              value={selectedGuildId}
              onChange={(e) => setSelectedGuildId(e.target.value)}
            >
              {authorizedGuilds.map((g) => (
                <option key={g.guildId} value={g.guildId}>
                  {g.name ?? g.guildId}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <input type="hidden" name="guildId" value={selectedGuildId} />
        )}

        {/* Channel picker — live fetch when guild changes, falls back to manual ID */}
        <label>
          Channel
          {channels.length > 0 ? (
            <select
              name="channelId"
              value={selectedChannelId}
              onChange={(e) => setSelectedChannelId(e.target.value)}
            >
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              name="channelId"
              defaultValue={defaultChannelId}
              onChange={(e) => setSelectedChannelId(e.target.value.trim())}
              pattern="^\d{17,20}$"
              title="Discord channel IDs are numeric and usually 17–20 digits."
              placeholder={channelsLoading ? "Loading channels…" : "123456789012345678"}
            />
          )}
        </label>

        <label>
          Event name
          <input name="title" required maxLength={120} placeholder="D&D Thursday Night" />
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

        {/* Recurring toggle — replaces the dead "Event type" dropdown */}
        <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <input
            type="checkbox"
            checked={isRecurring}
            onChange={(e) => setIsRecurring(e.target.checked)}
          />
          Recurring series
        </label>

        <label>
          Game
          <select name="gameSystem" defaultValue="D&D">
            <option value="D&D">D&amp;D</option>
            <option value="Daggerheart">Daggerheart</option>
            <option value="Board Game">Board Game</option>
          </select>
        </label>

        {!isRecurring && (
          <>
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
          </>
        )}

        {isRecurring && (
          <>
            <label>
              Recurring weekday
              <select name="weekday" defaultValue="FRI">
                {WEEKDAYS.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
            </label>
            <label>
              Cadence
              <select name="intervalWeeks" defaultValue="1">
                <option value="1">Every week</option>
                <option value="2">Every other week (biweekly)</option>
              </select>
            </label>
            <label>
              Start time
              <input name="startTime" type="time" required defaultValue="18:00" />
            </label>
            <label>
              Duration (minutes)
              <input name="durationMinutes" type="number" min={30} max={720} defaultValue={240} required />
            </label>
            <small className="muted span-all">
              First occurrence will be the next matching weekday. Additional occurrences can be generated from the series page.
            </small>
          </>
        )}

        <label className="span-all">
          Event graphic URL
          <input name="imageUrl" type="url" placeholder="https://example.com/event-poster.png" />
        </label>
        <label className="span-all">
          Description
          <textarea name="description" maxLength={2000} rows={3} />
        </label>

        {/* Collapsible signup-options section */}
        <div className="span-all" style={{ borderTop: "1px solid var(--color-border, #333)", paddingTop: "0.75rem" }}>
          <button
            type="button"
            className="button secondary"
            style={{ fontSize: "0.8rem", marginBottom: "0.75rem" }}
            onClick={() => setSignupOptionsExpanded((e) => !e)}
          >
            {signupOptionsExpanded ? "Hide signup options" : "Customize signup options (optional)"}
          </button>

          {signupOptionsExpanded && (
            <>
              <input type="hidden" name="_signupOptionsSubmitted" value="1" />
              <div className="field" style={{ marginBottom: "0.75rem" }}>
                <label>
                  Signup profile name
                  <input name="eventTypeName" maxLength={120} defaultValue="D&D Session Night" style={{ marginTop: "0.25rem" }} />
                </label>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(18rem, 1fr))", gap: "0.5rem 1.5rem", marginBottom: "0.75rem" }}>
                {[
                  { key: "requiresRsvp", label: "Requires RSVP", defaultChecked: true },
                  { key: "allowsGuests", label: "Allows guests", defaultChecked: true },
                  { key: "requiresAmbassadors", label: "Requires ambassadors", defaultChecked: true },
                  { key: "requiresTableAssignment", label: "Table assignment", defaultChecked: true },
                  { key: "usesPlayerCategories", label: "Player categories (Normal/Heroic)", defaultChecked: true },
                  { key: "createsTemporaryRoles", label: "Temporary Discord roles", defaultChecked: true },
                  { key: "requiresAttendanceConfirmation", label: "Attendance confirmation", defaultChecked: true },
                  { key: "sendsFeedbackPrompts", label: "Feedback prompts", defaultChecked: true },
                  { key: "usesWaitlist", label: "Waitlist", defaultChecked: true },
                  { key: "allowsNameOnlyWalkIns", label: "Name-only walk-ins", defaultChecked: true },
                ].map(({ key, label, defaultChecked }) => (
                  <label key={key} style={{ display: "flex", gap: "0.5rem", alignItems: "center", fontSize: "0.875rem" }}>
                    <input type="checkbox" name={key} value="true" defaultChecked={defaultChecked} />
                    {label}
                  </label>
                ))}
              </div>
              <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", fontSize: "0.875rem", marginBottom: "0.75rem" }}>
                Max guests per RSVP:
                <input name="maxGuestsPerRsvp" type="number" min={0} max={20} defaultValue={3} style={{ width: "4rem" }} />
              </label>
            </>
          )}
        </div>

        <div className="form-actions span-all">
          <button className="button" type="submit" disabled={pending}>
            {isRecurring ? <CalendarRange size={16} /> : <CalendarPlus size={16} />}
            {pending
              ? isRecurring ? "Creating series…" : "Creating…"
              : isRecurring ? "Create recurring series" : "Create event"}
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
