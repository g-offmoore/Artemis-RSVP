"use client";

import { useActionState, useState } from "react";
import { EligibilityRule, GuildSettings } from "../../../src/lib/artemis-api";
import { upsertEligibilityRuleAction, ActionState } from "../../actions";

const emptyState: ActionState = { ok: false, message: "" };

const SIGNUP_ROLES = ["PLAYER", "TABLE_DM", "BACKUP_DM", "AMBASSADOR"] as const;

type RoleCategory = { label: string; ids: string[] };

function buildCategories(settings: GuildSettings | null): RoleCategory[] {
  return [
    { label: "Staff", ids: settings?.staffRoleIds ?? [] },
    { label: "Admin", ids: settings?.adminRoleIds ?? [] },
    { label: "Ambassador", ids: settings?.ambassadorRoleIds ?? [] },
    { label: "Normal", ids: settings?.normalRoleIds ?? [] },
    { label: "Heroic", ids: settings?.heroicRoleIds ?? [] },
  ].filter((c) => c.ids.length > 0);
}

function RoleCheckboxes({
  name,
  categories,
  selectedIds,
}: {
  name: string;
  categories: RoleCategory[];
  selectedIds: string[];
}) {
  if (categories.length === 0) {
    return (
      <input
        name={name}
        defaultValue={selectedIds.join(", ")}
        placeholder="Discord role IDs, comma-separated"
        style={{ width: "100%" }}
      />
    );
  }
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem 1.5rem" }}>
      {categories.map((cat) =>
        cat.ids.map((id) => (
          <label key={id} style={{ display: "flex", gap: "0.25rem", alignItems: "center", fontSize: "0.875rem" }}>
            <input
              type="checkbox"
              name={name}
              value={id}
              defaultChecked={selectedIds.includes(id)}
            />
            <span className="muted">{cat.label}:</span>
            <code style={{ fontSize: "0.8rem" }}>{id}</code>
          </label>
        )),
      )}
    </div>
  );
}

function RuleForm({
  eventId,
  signupRole,
  existing,
  categories,
}: {
  eventId: string;
  signupRole: string;
  existing: EligibilityRule | undefined;
  categories: RoleCategory[];
}) {
  const [state, action, pending] = useActionState(upsertEligibilityRuleAction, emptyState);

  return (
    <form action={action} style={{ marginBottom: "1.5rem", padding: "1rem", background: "var(--color-surface, #1a1a2e)", borderRadius: "4px" }}>
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="signupRole" value={signupRole} />
      <h4 style={{ margin: "0 0 0.75rem" }}>{signupRole}</h4>

      <div className="field">
        <label>Allowed Role IDs <small className="muted">(any of these may sign up; empty = all allowed)</small></label>
        <RoleCheckboxes
          name="allowedDiscordRoleIds"
          categories={categories}
          selectedIds={existing?.allowedDiscordRoleIds ?? []}
        />
      </div>
      <div className="field">
        <label>Required Role IDs <small className="muted">(must have ALL of these)</small></label>
        <RoleCheckboxes
          name="requiredDiscordRoleIds"
          categories={categories}
          selectedIds={existing?.requiredDiscordRoleIds ?? []}
        />
      </div>
      <div className="field">
        <label>Denied Role IDs <small className="muted">(must not have any of these)</small></label>
        <RoleCheckboxes
          name="deniedDiscordRoleIds"
          categories={categories}
          selectedIds={existing?.deniedDiscordRoleIds ?? []}
        />
      </div>
      <div className="field">
        <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <input
            type="checkbox"
            name="requiresApproval"
            value="true"
            defaultChecked={existing?.requiresApproval ?? false}
          />
          Requires organizer approval
        </label>
      </div>

      {state.message && (
        <p className={state.ok ? "success" : "error"}>{state.message}</p>
      )}
      <button type="submit" disabled={pending} className="button secondary">
        {pending ? "Saving…" : `Save ${signupRole} rule`}
      </button>
    </form>
  );
}

export function EligibilityRulesPanel({
  eventId,
  rules,
  settings,
}: {
  eventId: string;
  rules: EligibilityRule[];
  settings: GuildSettings | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const categories = buildCategories(settings);

  return (
    <section>
      <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1rem" }}>
        <h2 style={{ margin: 0 }}>Eligibility Rules</h2>
        <button
          className="button secondary"
          type="button"
          onClick={() => setExpanded((e) => !e)}
          style={{ fontSize: "0.8rem" }}
        >
          {expanded ? "Collapse" : `Edit (${rules.length} rule${rules.length !== 1 ? "s" : ""})`}
        </button>
      </div>
      {rules.length > 0 && !expanded && (
        <table className="table">
          <thead>
            <tr>
              <th>Signup Role</th>
              <th>Allowed IDs</th>
              <th>Required IDs</th>
              <th>Denied IDs</th>
              <th>Approval</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id}>
                <td>{r.signupRole}</td>
                <td className="muted">{r.allowedDiscordRoleIds.length ? r.allowedDiscordRoleIds.join(", ") : "Any"}</td>
                <td className="muted">{r.requiredDiscordRoleIds.join(", ") || "—"}</td>
                <td className="muted">{r.deniedDiscordRoleIds.join(", ") || "—"}</td>
                <td>{r.requiresApproval ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {expanded && (
        <>
          {categories.length === 0 && (
            <p className="muted" style={{ marginBottom: "1rem" }}>
              No role categories configured. Add role IDs in{" "}
              <a href="/settings">Guild Settings</a> to enable checkbox selection, or enter IDs manually below.
            </p>
          )}
          {SIGNUP_ROLES.map((role) => (
            <RuleForm
              key={role}
              eventId={eventId}
              signupRole={role}
              existing={rules.find((r) => r.signupRole === role)}
              categories={categories}
            />
          ))}
        </>
      )}
    </section>
  );
}
