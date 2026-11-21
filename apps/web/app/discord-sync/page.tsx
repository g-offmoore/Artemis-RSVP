import Link from "next/link";
import { artemisApi } from "../../src/lib/artemis-api";
import { requireSession } from "../../src/lib/auth";

type EventRef = { id: string; title: string; startAt?: string };

type SyncFailures = {
  failedRoles: Array<{ id: string; lastError: string | null; failedAt: string | null; event: EventRef }>;
  failedThreadEvents: Array<{ id: string; title: string; startAt: string; threadRetryCount: number }>;
  failedMessageJobs: Array<{ id: string; messageType: string; lastError: string | null; failedAt: string | null; event: EventRef }>;
  failedPostLogs: Array<{ id: string; eventId: string | null; createdAt: string; afterValue: { message?: string } | null }>;
  failedMemberships: Array<{ id: string; discordUserId: string; desired: boolean; lastError: string | null; event: EventRef }>;
  roleCleanupFailures: Array<{ id: string; lastError: string | null; cleanupAttempts: number; event: EventRef }>;
};

function EventLink({ event }: { event: EventRef }) {
  return <Link href={`/events/${event.id}`}>{event.title}</Link>;
}

// Server-wide list of Discord work Artemis could not complete. Each row links
// to the event, where the Discord Sync panel has the repair actions.
export default async function DiscordSyncPage() {
  const session = await requireSession();
  const guildId = session.activeGuildId;
  const failures = await artemisApi<SyncFailures>(
    `/api/v1/events/discord-sync-failures?guildId=${guildId}`,
    { guildId },
  ).catch(() => null);

  const total = failures
    ? failures.failedRoles.length +
      failures.failedThreadEvents.length +
      failures.failedMessageJobs.length +
      failures.failedMemberships.length +
      failures.roleCleanupFailures.length +
      failures.failedPostLogs.length
    : 0;

  return (
    <>
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/">Dashboard</Link>
        <span>/</span>
        <span>Discord Sync</span>
      </nav>
      <section className="page-title">
        <h1>Discord Sync</h1>
        <p className="muted">
          Roles, threads, member access, and messages Artemis could not complete in Discord. Open an
          event to retry or re-sync it.
        </p>
      </section>

      {!failures ? (
        <p className="form-message error">Could not load sync status from the API.</p>
      ) : total === 0 ? (
        <p className="form-message ok">Everything is in sync.</p>
      ) : (
        <>
          {failures.failedMemberships.length > 0 && (
            <>
              <h2>Member access</h2>
              <table className="table">
                <thead>
                  <tr><th>Event</th><th>Discord user</th><th>Change</th><th>Error</th></tr>
                </thead>
                <tbody>
                  {failures.failedMemberships.map((m) => (
                    <tr key={m.id}>
                      <td><EventLink event={m.event} /></td>
                      <td>{m.discordUserId}</td>
                      <td>{m.desired ? "Grant access" : "Remove access"}</td>
                      <td>{m.lastError ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {failures.failedMessageJobs.length > 0 && (
            <>
              <h2>Messages</h2>
              <table className="table">
                <thead>
                  <tr><th>Event</th><th>Message</th><th>Error</th></tr>
                </thead>
                <tbody>
                  {failures.failedMessageJobs.map((j) => (
                    <tr key={j.id}>
                      <td><EventLink event={j.event} /></td>
                      <td>{j.messageType}</td>
                      <td>{j.lastError ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {(failures.failedRoles.length > 0 || failures.roleCleanupFailures.length > 0) && (
            <>
              <h2>Event roles</h2>
              <table className="table">
                <thead>
                  <tr><th>Event</th><th>Problem</th><th>Error</th></tr>
                </thead>
                <tbody>
                  {failures.failedRoles.map((r) => (
                    <tr key={r.id}>
                      <td><EventLink event={r.event} /></td>
                      <td>Could not create</td>
                      <td>{r.lastError ?? ""}</td>
                    </tr>
                  ))}
                  {failures.roleCleanupFailures.map((r) => (
                    <tr key={`cleanup-${r.id}`}>
                      <td><EventLink event={r.event} /></td>
                      <td>Could not delete after {r.cleanupAttempts} attempt(s)</td>
                      <td>{r.lastError ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {failures.failedThreadEvents.length > 0 && (
            <>
              <h2>Event threads</h2>
              <table className="table">
                <thead>
                  <tr><th>Event</th><th>Automatic attempts</th></tr>
                </thead>
                <tbody>
                  {failures.failedThreadEvents.map((e) => (
                    <tr key={e.id}>
                      <td><EventLink event={e} /></td>
                      <td>{e.threadRetryCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {failures.failedPostLogs.length > 0 && (
            <>
              <h2>Recent post failures</h2>
              <table className="table">
                <thead>
                  <tr><th>Event</th><th>When</th><th>Error</th></tr>
                </thead>
                <tbody>
                  {failures.failedPostLogs.map((log) => (
                    <tr key={log.id}>
                      <td>{log.eventId ? <Link href={`/events/${log.eventId}`}>Open event</Link> : "—"}</td>
                      <td>{new Date(log.createdAt).toLocaleString()}</td>
                      <td>{log.afterValue?.message ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </>
  );
}
