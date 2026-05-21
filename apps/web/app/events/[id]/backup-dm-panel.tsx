"use client";

import { useActionState } from "react";
import { ActionState, backupDmActionAction } from "../../actions";

type Candidate = {
  rsvpId: string;
  discordUserId: string;
  participantId: string | null;
  backupDmStatus: string | null;
  rsvpCreatedAt: string;
  lastDmDate: string | null;
  dmCountLast30Days: number;
  backupPullCountLast90Days: number;
};

const initialState: ActionState = { ok: false, message: "" };

export function BackupDmPanel({
  eventId,
  candidates,
}: {
  eventId: string;
  candidates: Candidate[];
}) {
  const [state, formAction, pending] = useActionState(
    backupDmActionAction,
    initialState,
  );

  if (candidates.length === 0) return null;

  return (
    <section className="section-panel" aria-labelledby="backup-dm-heading">
      <div className="section-heading">
        <div>
          <h2 id="backup-dm-heading">Backup DM Candidates</h2>
          <p className="muted">
            Sorted by burnout priority: least recently DM&rsquo;d, lowest recent count.
          </p>
        </div>
      </div>

      {state.message ? (
        <p className={state.ok ? "form-message ok" : "form-message error"}>
          {state.message}
        </p>
      ) : null}

      <table className="table">
        <thead>
          <tr>
            <th>Candidate</th>
            <th>Status</th>
            <th>Last DM&rsquo;d</th>
            <th>DMs (30d)</th>
            <th>Pulls (90d)</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((c, idx) => (
            <tr key={c.discordUserId}>
              <td>
                <strong>#{idx + 1}</strong> &nbsp;<code>{c.discordUserId}</code>
              </td>
              <td>{c.backupDmStatus ?? "Available"}</td>
              <td>{c.lastDmDate ? new Date(c.lastDmDate).toLocaleDateString() : "Never"}</td>
              <td>{c.dmCountLast30Days}</td>
              <td>{c.backupPullCountLast90Days}</td>
              <td>
                {c.participantId &&
                  c.backupDmStatus !== "BACKUP_PULLED_TO_DM" &&
                  c.backupDmStatus !== "BACKUP_DECLINED_PULL" && (
                    <form
                      action={formAction}
                      style={{ display: "inline-flex", gap: "0.4rem", flexWrap: "wrap" }}
                      onSubmit={(e) => {
                        const action = (e.nativeEvent as SubmitEvent & { submitter?: HTMLButtonElement })
                          .submitter?.value;
                        if (action === "pull") {
                          if (!window.confirm(
                            "Force-pull this backup DM? Their player seat will be released immediately."
                          )) e.preventDefault();
                        }
                      }}
                    >
                      <input type="hidden" name="eventId" value={eventId} />
                      <input type="hidden" name="participantId" value={c.participantId} />
                      <button
                        className="button secondary"
                        type="submit"
                        name="action"
                        value="pull"
                        disabled={pending}
                        style={{ fontSize: "0.8rem", padding: "0.25rem 0.6rem" }}
                      >
                        Force pull
                      </button>
                    </form>
                  )}
                {c.backupDmStatus === "BACKUP_PULLED_TO_DM" && (
                  <form action={formAction} style={{ display: "inline-flex", gap: "0.4rem" }}>
                    <input type="hidden" name="eventId" value={eventId} />
                    <input type="hidden" name="participantId" value={c.participantId ?? ""} />
                    <button
                      className="button secondary"
                      type="submit"
                      name="action"
                      value="release"
                      disabled={pending}
                      style={{ fontSize: "0.8rem", padding: "0.25rem 0.6rem" }}
                    >
                      Release
                    </button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
