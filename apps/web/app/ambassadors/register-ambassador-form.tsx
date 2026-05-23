"use client";

import { useActionState } from "react";
import { registerAmbassadorAction, ActionState } from "../actions";

const emptyState: ActionState = { ok: false, message: "" };

export function RegisterAmbassadorForm() {
  const [state, action, pending] = useActionState(registerAmbassadorAction, emptyState);

  return (
    <form action={action}>
      <div className="field">
        <label>Discord User ID</label>
        <input name="discordUserId" required placeholder="Discord snowflake" />
      </div>
      <div className="field">
        <label>Display Name</label>
        <input name="displayName" required placeholder="Name shown in UI and rosters" />
      </div>
      <div className="field">
        <label>Supported Game Systems</label>
        <input name="supportedGameSystems" placeholder="D&D, Daggerheart, Pathfinder" />
        <small className="muted">Comma-separated</small>
      </div>
      <div className="field">
        <label>Default Soft Cap</label>
        <input name="defaultSoftCap" type="number" min={1} max={20} defaultValue={6} />
      </div>
      <div className="field">
        <label>Default Hard Cap</label>
        <input name="defaultHardCap" type="number" min={1} max={20} defaultValue={7} />
      </div>
      <div className="field">
        <label>Default Table Type</label>
        <select name="defaultTableType" defaultValue="MIXED">
          <option value="MIXED">Mixed</option>
          <option value="AL_LEGAL">AL Legal</option>
          <option value="HOMEBREW">Homebrew</option>
          <option value="ONE_SHOT">One Shot</option>
        </select>
      </div>
      <div className="field">
        <label>Notes</label>
        <textarea name="notes" rows={2} placeholder="Optional internal notes" />
      </div>
      {state.message && (
        <p className={state.ok ? "success" : "error"}>{state.message}</p>
      )}
      <button type="submit" disabled={pending}>
        {pending ? "Registering…" : "Register Ambassador"}
      </button>
    </form>
  );
}
