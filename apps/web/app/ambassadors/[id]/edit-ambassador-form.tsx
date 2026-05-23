"use client";

import { useActionState } from "react";
import { AmbassadorProfile } from "../../../src/lib/artemis-api";
import { updateAmbassadorAction, deregisterAmbassadorAction, ActionState } from "../../actions";

const emptyState: ActionState = { ok: false, message: "" };

export function EditAmbassadorForm({ ambassador }: { ambassador: AmbassadorProfile }) {
  const [updateState, updateAction, updatePending] = useActionState(updateAmbassadorAction, emptyState);
  const [deregState, deregAction, deregPending] = useActionState(deregisterAmbassadorAction, emptyState);

  return (
    <>
      <form action={updateAction}>
        <input type="hidden" name="ambassadorId" value={ambassador.id} />

        <h3>Profile</h3>
        <div className="field">
          <label>Display Name</label>
          <input name="displayName" defaultValue={ambassador.displayName} required />
        </div>
        <div className="field">
          <label>Supported Game Systems</label>
          <input
            name="supportedGameSystems"
            defaultValue={ambassador.supportedGameSystems.join(", ")}
            placeholder="D&D, Daggerheart, Pathfinder"
          />
          <small className="muted">Comma-separated</small>
        </div>
        <div className="field">
          <label>Default Soft Cap</label>
          <input name="defaultSoftCap" type="number" min={1} max={20} defaultValue={ambassador.defaultSoftCap} />
        </div>
        <div className="field">
          <label>Default Hard Cap</label>
          <input name="defaultHardCap" type="number" min={1} max={20} defaultValue={ambassador.defaultHardCap} />
        </div>
        <div className="field">
          <label>Default Table Type</label>
          <select name="defaultTableType" defaultValue={ambassador.defaultTableType}>
            <option value="MIXED">Mixed</option>
            <option value="AL_LEGAL">AL Legal</option>
            <option value="HOMEBREW">Homebrew</option>
            <option value="ONE_SHOT">One Shot</option>
          </select>
        </div>
        <div className="field">
          <label>Active</label>
          <select name="active" defaultValue={ambassador.active ? "true" : "false"}>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </div>
        <div className="field">
          <label>Notes</label>
          <textarea name="notes" rows={3} defaultValue={ambassador.notes ?? ""} />
        </div>

        <h3>Burnout Stats Override</h3>
        <p className="muted" style={{ marginBottom: "1rem" }}>
          These are normally updated automatically. Override here only for manual corrections.
        </p>
        <div className="field">
          <label>DM Count (last 30 days)</label>
          <input
            name="dmCountLast30Days"
            type="number"
            min={0}
            defaultValue={ambassador.dmCountLast30Days}
          />
        </div>
        <div className="field">
          <label>Backup Pull Count (last 90 days)</label>
          <input
            name="backupPullCountLast90Days"
            type="number"
            min={0}
            defaultValue={ambassador.backupPullCountLast90Days}
          />
        </div>
        <div className="field">
          <label>Last DM Date</label>
          <input
            name="lastDmDate"
            type="date"
            defaultValue={
              ambassador.lastDmDate
                ? new Date(ambassador.lastDmDate).toISOString().split("T")[0]
                : ""
            }
          />
        </div>

        {updateState.message && (
          <p className={updateState.ok ? "success" : "error"}>{updateState.message}</p>
        )}
        <button type="submit" disabled={updatePending}>
          {updatePending ? "Saving…" : "Save Changes"}
        </button>
      </form>

      <hr style={{ margin: "2rem 0", borderColor: "var(--color-border, #333)" }} />

      <h3>Deregister</h3>
      <p className="muted">
        Marks the ambassador as inactive. Their profile and history are retained.
      </p>
      <form action={deregAction}>
        <input type="hidden" name="ambassadorId" value={ambassador.id} />
        {deregState.message && (
          <p className={deregState.ok ? "success" : "error"}>{deregState.message}</p>
        )}
        <button
          type="submit"
          disabled={deregPending || !ambassador.active}
          style={{ background: "var(--color-danger, #c0392b)" }}
        >
          {deregPending ? "Deregistering…" : "Deregister Ambassador"}
        </button>
      </form>
    </>
  );
}
