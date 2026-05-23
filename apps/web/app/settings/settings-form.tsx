"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { GuildSettings } from "../../src/lib/artemis-api";
import { updateSettingsAction, ActionState } from "../actions";

const emptyState: ActionState = { ok: false, message: "" };

export function SettingsForm({
  settings,
  canEdit,
  currentUserId,
}: {
  settings: GuildSettings | null;
  canEdit: boolean;
  currentUserId: string;
}) {
  const [state, action, pending] = useActionState(updateSettingsAction, emptyState);
  const formRef = useRef<HTMLFormElement>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [lastAttemptedAt, setLastAttemptedAt] = useState<string | null>(null);
  const [validationMessage, setValidationMessage] = useState<string>("");

  const joinIds = (ids: string[] | undefined) => (ids ?? []).join("\n");

  const isSnowflake = (value: string) => /^\d{17,20}$/.test(value.trim());
  const isTimezoneLike = (value: string) => /^[A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?$/.test(value.trim());

  const validateForm = () => {
    const form = formRef.current;
    if (!form) return "";

    const timezone = (form.elements.namedItem("defaultTimezone") as HTMLInputElement).value.trim();
    const channelId = (form.elements.namedItem("defaultEventChannelId") as HTMLInputElement).value.trim();
    const adminRoleIds = (form.elements.namedItem("adminRoleIds") as HTMLTextAreaElement).value;
    const allRoleValues = [
      adminRoleIds,
      (form.elements.namedItem("staffRoleIds") as HTMLTextAreaElement).value,
      (form.elements.namedItem("ambassadorRoleIds") as HTMLTextAreaElement).value,
      (form.elements.namedItem("normalRoleIds") as HTMLTextAreaElement).value,
      (form.elements.namedItem("heroicRoleIds") as HTMLTextAreaElement).value,
    ]
      .join("\n")
      .split(/[\n,]+/)
      .map((v) => v.trim())
      .filter(Boolean);

    if (!timezone || !isTimezoneLike(timezone)) return "Enter a valid default timezone (e.g., America/New_York).";
    if (!channelId || !isSnowflake(channelId)) return "Default event channel ID is required and must be a Discord snowflake.";
    if (!adminRoleIds.trim()) return "At least one admin role ID is required to protect settings access.";
    if (allRoleValues.some((id) => !isSnowflake(id))) return "All role IDs must be valid Discord snowflakes (17–20 digits).";
    return "";
  };

  const onSubmit = () => {
    if (!canEdit) return;
    const message = validateForm();
    setValidationMessage(message);
    if (message) return;
    setLastAttemptedAt(new Date().toISOString());
    setToast(null);
  };

  useEffect(() => {
    if (state.message && !pending) {
      setToast({ type: state.ok ? "success" : "error", message: state.message });
    }
  }, [state, pending]);

  return (
    <form ref={formRef} action={action} onSubmit={onSubmit}>
      {!canEdit && (
        <p className="error" style={{ marginBottom: "1rem" }}>
          Read-only mode: you are signed in as <code>{currentUserId}</code> and do not hold a configured admin role.
          Ask a guild admin to update settings.
        </p>
      )}

      <h2>Guild defaults</h2>
      <div className="field">
        <label>Default Timezone</label>
        <input
          name="defaultTimezone"
          defaultValue={settings?.defaultTimezone ?? "America/New_York"}
          placeholder="America/New_York"
          required
          readOnly={!canEdit}
        />
      </div>
      <div className="field">
        <label>Default Event Channel ID</label>
        <input
          name="defaultEventChannelId"
          defaultValue={settings?.defaultEventChannelId ?? ""}
          placeholder="Discord channel snowflake"
          required
          readOnly={!canEdit}
        />
      </div>
      <h2>Role access</h2>
      <p className="muted" style={{ marginBottom: "1rem" }}>
        Paste Discord role IDs from Developer Mode: right-click role → <em>Copy ID</em>, then paste one per line.
      </p>

      <div className="field">
        <label>Staff Role IDs</label>
        <textarea name="staffRoleIds" rows={3} defaultValue={joinIds(settings?.staffRoleIds)} readOnly={!canEdit} />
      </div>
      <div className="field">
        <label>Admin Role IDs</label>
        <textarea name="adminRoleIds" rows={3} defaultValue={joinIds(settings?.adminRoleIds)} readOnly={!canEdit} required />
      </div>
      <div className="field">
        <label>Ambassador Role IDs</label>
        <textarea name="ambassadorRoleIds" rows={3} defaultValue={joinIds(settings?.ambassadorRoleIds)} readOnly={!canEdit} />
      </div>
      <div className="field">
        <label>Normal (Regular) Role IDs</label>
        <textarea name="normalRoleIds" rows={3} defaultValue={joinIds(settings?.normalRoleIds)} readOnly={!canEdit} />
      </div>
      <div className="field">
        <label>Heroic Role IDs</label>
        <textarea name="heroicRoleIds" rows={3} defaultValue={joinIds(settings?.heroicRoleIds)} readOnly={!canEdit} />
      </div>

      <h2>Operational policies</h2>
      <div className="field">
        <label>Temporary Role Cleanup (days, 1–90)</label>
        <input
          name="temporaryRoleCleanupDays"
          type="number"
          min={1}
          max={90}
          defaultValue={settings?.temporaryRoleCleanupDays ?? 30}
          readOnly={!canEdit}
        />
      </div>
      <div className="field">
        <label>Feedback Form URL</label>
        <input
          name="feedbackFormUrl"
          defaultValue={settings?.feedbackFormUrl ?? ""}
          placeholder="https://forms.gle/..."
          readOnly={!canEdit}
        />
      </div>

      <p className="muted">
        Last settings update: {settings?.updatedAt ? new Date(settings.updatedAt).toLocaleString() : "Not yet recorded"}
        {" "}by {settings?.updatedByDiscordId ?? "unknown user"}.
      </p>

      {validationMessage && <p className="error">{validationMessage}</p>}
      {toast && <p className={toast.type === "success" ? "success" : "error"}>{toast.message}</p>}

      {toast?.type === "error" && canEdit && (
        <button type="button" onClick={() => formRef.current?.requestSubmit()} disabled={pending}>
          Retry save
        </button>
      )}
      <button type="submit" disabled={pending || !canEdit}>
        {pending ? "Saving…" : "Save Settings"}
      </button>
      {lastAttemptedAt && <p className="muted">Last save attempt: {new Date(lastAttemptedAt).toLocaleString()}</p>}
    </form>
  );
}
