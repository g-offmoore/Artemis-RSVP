"use client";

import { useActionState } from "react";
import { RefreshCw, Users } from "lucide-react";
import {
  ActionState,
  repairMembershipsAction,
  retryEventThreadAction,
  retryMessageJobAction,
} from "../../actions";

const initialState: ActionState = { ok: false, message: "" };

export type DiscordStatus = {
  post: { channelId: string | null; messageId: string | null };
  thread: { discordThreadId: string | null; retryCount: number };
  role: {
    discordRoleId: string | null;
    failedAt: string | null;
    lastError: string | null;
    deletedAt: string | null;
    cleanupAttempts: number;
  } | null;
  memberships: {
    synced: number;
    pending: number;
    failed: number;
    problems: Array<{
      discordUserId: string;
      desired: boolean;
      status: string;
      attempts: number;
      lastError: string | null;
      nextAttemptAt: string | null;
    }>;
  };
};

export type FailedJob = { id: string; messageType: string; lastError?: string | null };

function Message({ state }: { state: ActionState }) {
  if (!state.message) return null;
  return <p className={state.ok ? "form-message ok" : "form-message error"}>{state.message}</p>;
}

function roleSummary(role: DiscordStatus["role"]): string {
  if (!role) return "Not created yet";
  if (role.deletedAt) return "Removed after the event";
  if (!role.discordRoleId) return `Failed: ${role.lastError ?? "unknown error"}`;
  if (role.cleanupAttempts > 0) return `Cleanup failing: ${role.lastError ?? "unknown error"}`;
  return "Created";
}

// Staff view of what Artemis believes exists in Discord for this event, with
// repair actions. Errors are shown as stored (sanitized by the API) so staff
// can tell a missing permission from a deleted object.
export function DiscordSyncPanel({
  eventId,
  status,
  failedJobs,
}: {
  eventId: string;
  status: DiscordStatus | null;
  failedJobs: FailedJob[];
}) {
  const [threadState, threadAction, threadPending] = useActionState(retryEventThreadAction, initialState);
  const [repairState, repairAction, repairPending] = useActionState(repairMembershipsAction, initialState);

  if (!status) {
    return (
      <section>
        <h2>Discord Sync</h2>
        <p className="muted">Discord sync status is unavailable right now.</p>
      </section>
    );
  }

  const { memberships } = status;

  return (
    <section>
      <h2>Discord Sync</h2>
      <table className="table">
        <tbody>
          <tr>
            <th scope="row">Event post</th>
            <td>{status.post.messageId ? "Posted" : "Not posted yet"}</td>
          </tr>
          <tr>
            <th scope="row">Player role</th>
            <td>{roleSummary(status.role)}</td>
          </tr>
          <tr>
            <th scope="row">Private thread</th>
            <td>
              {status.thread.discordThreadId
                ? "Created"
                : status.thread.retryCount > 0
                  ? `Not created after ${status.thread.retryCount} automatic attempt(s)`
                  : "Not created yet"}
            </td>
          </tr>
          <tr>
            <th scope="row">Member access</th>
            <td>
              {memberships.synced} in sync · {memberships.pending} pending · {memberships.failed} failed
            </td>
          </tr>
        </tbody>
      </table>

      {memberships.problems.length > 0 ? (
        <table className="table">
          <thead>
            <tr>
              <th>Discord user</th>
              <th>Should have access</th>
              <th>Status</th>
              <th>Last error</th>
            </tr>
          </thead>
          <tbody>
            {memberships.problems.map((m) => (
              <tr key={m.discordUserId}>
                <td>{m.discordUserId}</td>
                <td>{m.desired ? "Yes" : "No (remove)"}</td>
                <td>
                  {m.status}
                  {m.attempts > 0 ? ` (${m.attempts} attempt${m.attempts === 1 ? "" : "s"})` : ""}
                </td>
                <td>{m.lastError ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <div className="form-actions">
        {!status.thread.discordThreadId ? (
          <form action={threadAction}>
            <input type="hidden" name="eventId" value={eventId} />
            <button className="button secondary" type="submit" disabled={threadPending}>
              <RefreshCw size={16} />
              {threadPending ? "Retrying" : "Retry thread"}
            </button>
          </form>
        ) : null}
        <form action={repairAction}>
          <input type="hidden" name="eventId" value={eventId} />
          <button className="button secondary" type="submit" disabled={repairPending}>
            <Users size={16} />
            {repairPending ? "Re-checking" : "Re-sync member access"}
          </button>
        </form>
      </div>
      <Message state={threadState} />
      <Message state={repairState} />

      {failedJobs.length > 0 ? (
        <>
          <h3>Failed messages</h3>
          <table className="table">
            <tbody>
              {failedJobs.map((job) => (
                <FailedJobRow key={job.id} eventId={eventId} job={job} />
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </section>
  );
}

function FailedJobRow({ eventId, job }: { eventId: string; job: FailedJob }) {
  const [state, action, pending] = useActionState(retryMessageJobAction, initialState);
  return (
    <tr>
      <td>{job.messageType}</td>
      <td>{job.lastError ?? "Unknown error"}</td>
      <td>
        <form action={action}>
          <input type="hidden" name="eventId" value={eventId} />
          <input type="hidden" name="jobId" value={job.id} />
          <button className="button secondary" type="submit" disabled={pending}>
            {pending ? "Queuing" : "Send again"}
          </button>
        </form>
        <Message state={state} />
      </td>
    </tr>
  );
}
