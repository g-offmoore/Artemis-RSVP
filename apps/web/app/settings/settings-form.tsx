"use client";

import { useActionState } from "react";
import { GuildSettings } from "../../src/lib/artemis-api";
import { updateSettingsAction, ActionState } from "../actions";

const emptyState: ActionState = { ok: false, message: "" };

export function SettingsForm({ settings }: { settings: GuildSettings | null }) {
  const [state, action, pending] = useActionState(updateSettingsAction, emptyState);

  const joinIds = (ids: string[] | undefined) => (ids ?? []).join("\n");

  return (
    <form action={action}>
      <h2>General</h2>
      <div className="field">
        <label>Default Timezone</label>
        <input
          name="defaultTimezone"
          defaultValue={settings?.defaultTimezone ?? "America/New_York"}
          placeholder="America/New_York"
        />
      </div>
      <div className="field">
        <label>Default Event Channel ID</label>
        <input
          name="defaultEventChannelId"
          defaultValue={settings?.defaultEventChannelId ?? ""}
          placeholder="Discord channel snowflake"
        />
      </div>
      <div className="field">
        <label>Feedback Form URL</label>
        <input
          name="feedbackFormUrl"
          defaultValue={settings?.feedbackFormUrl ?? ""}
          placeholder="https://forms.gle/..."
        />
      </div>
      <div className="field">
        <label>Temporary Role Cleanup (days, 1–90)</label>
        <input
          name="temporaryRoleCleanupDays"
          type="number"
          min={1}
          max={90}
          defaultValue={settings?.temporaryRoleCleanupDays ?? 30}
        />
      </div>

      <h2>Role IDs</h2>
      <p className="muted" style={{ marginBottom: "1rem" }}>
        One Discord role snowflake ID per line (or comma-separated).
      </p>
      <div className="field">
        <label>Staff Role IDs</label>
        <textarea name="staffRoleIds" rows={3} defaultValue={joinIds(settings?.staffRoleIds)} />
      </div>
      <div className="field">
        <label>Admin Role IDs</label>
        <textarea name="adminRoleIds" rows={3} defaultValue={joinIds(settings?.adminRoleIds)} />
      </div>
      <div className="field">
        <label>Ambassador Role IDs</label>
        <textarea name="ambassadorRoleIds" rows={3} defaultValue={joinIds(settings?.ambassadorRoleIds)} />
      </div>
      <div className="field">
        <label>Normal (Regular) Role IDs</label>
        <textarea name="normalRoleIds" rows={3} defaultValue={joinIds(settings?.normalRoleIds)} />
      </div>
      <div className="field">
        <label>Heroic Role IDs</label>
        <textarea name="heroicRoleIds" rows={3} defaultValue={joinIds(settings?.heroicRoleIds)} />
      </div>

      {state.message && (
        <p className={state.ok ? "success" : "error"}>{state.message}</p>
      )}
      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save Settings"}
      </button>
    </form>
  );
}
