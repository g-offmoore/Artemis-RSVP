import Link from "next/link";
import { artemisApi, EventDetail, GuildSettings } from "../../../src/lib/artemis-api";
import { BackupDmPanel } from "./backup-dm-panel";
import { EditEventForm } from "./edit-event-form";
import { EventManagement } from "./event-management";

const guildId = process.env.DISCORD_GUILD_ID;

function toDateInputValue(isoString: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(isoString));
}

function toTimeInputValue(isoString: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(isoString));
}

export default async function EventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [event, settings, messageJobs, backupDmCandidates] = await Promise.all([
    artemisApi<EventDetail>(`/api/v1/events/${id}`),
    guildId
      ? artemisApi<GuildSettings>(
          `/api/v1/guild-settings?guildId=${guildId}`,
        ).catch(() => null)
      : Promise.resolve(null),
    artemisApi<EventDetail["messageJobs"]>(`/api/v1/events/${id}/message-jobs`).catch(() => []),
    artemisApi<Array<{
      rsvpId: string;
      discordUserId: string;
      participantId: string | null;
      backupDmStatus: string | null;
      rsvpCreatedAt: string;
      lastDmDate: string | null;
      dmCountLast30Days: number;
      backupPullCountLast90Days: number;
    }>>(`/api/v1/events/${id}/backup-dm/candidates`).catch(() => []),
  ]);
  const eventTimeZone =
    settings?.defaultTimezone ??
    process.env.ARTEMIS_EVENT_TIME_ZONE ??
    "America/New_York";

  return (
    <>
      <section className="page-title">
        <div>
          <Link className="muted" href="/">
            Back to events
          </Link>
          <h1>{event.title}</h1>
          <p className="muted">
            {event.gameSystem} &mdash;{" "}
            {new Intl.DateTimeFormat("en-US", {
              timeZone: eventTimeZone,
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date(event.startAt))}
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.25rem" }}>
          <span className="status">{event.status}</span>
          {event.messageId && guildId ? (
            <a
              className="muted"
              href={`https://discord.com/channels/${guildId}/${event.channelId}/${event.messageId}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: "0.75rem" }}
            >
              Discord post &rarr;
            </a>
          ) : event.status !== "CANCELLED" ? (
            <span className="muted" style={{ fontSize: "0.75rem" }}>
              Not published
            </span>
          ) : null}
        </div>
      </section>

      <section className="grid">
        <div className="stat">
          <span className="muted">Participants</span>
          <strong>{event.participants.length}</strong>
        </div>
        <div className="stat">
          <span className="muted">Tables</span>
          <strong>{event.tables.length}</strong>
        </div>
        <div className="stat">
          <span className="muted">
            {event.assignmentLockedAt ? "Confirmed Seated" : "Projected Seated"}
          </span>
          <strong>
            {
              event.assignments.filter((a) =>
                event.assignmentLockedAt
                  ? a.status === "CONFIRMED_SEATED"
                  : a.status === "PROJECTED_SEATED" || a.status === "ASSIGNED",
              ).length
            }
          </strong>
        </div>
        {event.assignmentLockedAt && (
          <div className="stat">
            <span className="muted">Locked</span>
            <strong style={{ fontSize: "0.85rem" }}>
              {new Intl.DateTimeFormat("en-US", {
                timeZone: eventTimeZone,
                dateStyle: "short",
                timeStyle: "short",
              }).format(new Date(event.assignmentLockedAt))}
            </strong>
          </div>
        )}
      </section>

      {event.imageUrl ? (
        <img className="event-graphic" src={event.imageUrl} alt="" />
      ) : null}

      <EventManagement
        eventId={event.id}
        gameSystem={event.gameSystem}
        messageId={event.messageId}
        status={event.status}
        assignmentLockedAt={event.assignmentLockedAt}
      />

      <BackupDmPanel eventId={event.id} candidates={backupDmCandidates ?? []} />

      <EditEventForm
        eventId={event.id}
        defaultTitle={event.title}
        defaultGameSystem={event.gameSystem}
        defaultDate={toDateInputValue(event.startAt, eventTimeZone)}
        defaultStartTime={toTimeInputValue(event.startAt, eventTimeZone)}
        defaultEndTime={toTimeInputValue(event.endAt, eventTimeZone)}
        defaultImageUrl={event.imageUrl}
        defaultDescription={event.description}
        defaultTimezone={eventTimeZone}
      />

      <h2>Tables</h2>
      <table className="table">
        <thead>
          <tr>
            <th>Table</th>
            <th>DM / Host</th>
            <th>Type</th>
            <th>Capacity (soft/hard)</th>
            <th>Assigned</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {event.tables.map((table) => {
            const assignedCount = event.assignments.filter(
              (a) =>
                a.eventTableId === table.id &&
                (a.status === "CONFIRMED_SEATED" ||
                  a.status === "PROJECTED_SEATED" ||
                  a.status === "ASSIGNED"),
            ).length;
            return (
              <tr key={table.id}>
                <td>{table.title}</td>
                <td>{table.ambassadorProfile?.displayName ?? "—"}</td>
                <td>{table.tableType}</td>
                <td>
                  {table.softCap}/{table.hardCap}
                </td>
                <td>
                  {assignedCount}/{table.hardCap}
                  {assignedCount > table.softCap ? (
                    <span style={{ color: "var(--color-warning, orange)", marginLeft: "0.4rem" }}>
                      (over soft cap)
                    </span>
                  ) : null}
                </td>
                <td>{table.status}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h2>Participants</h2>
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Category</th>
            <th>Role</th>
            <th>Attendance</th>
            <th>Assignment</th>
          </tr>
        </thead>
        <tbody>
          {event.participants.map((participant) => {
            const seatedStatuses = [
              "ASSIGNED",
              "PROJECTED_SEATED",
              "CONFIRMED_SEATED",
            ];
            const assignment = event.assignments.find(
              (item) =>
                item.eventParticipantId === participant.id &&
                seatedStatuses.includes(item.status),
            );
            const table = event.tables.find(
              (item) => item.id === assignment?.eventTableId,
            );
            const assignmentLabel = assignment
              ? table?.title
                ? `${table.title}${assignment.status.startsWith("PROJECTED") ? " (projected)" : ""}`
                : assignment.status
              : "Unassigned";
            return (
              <tr key={participant.id}>
                <td>{participant.displayName}</td>
                <td>{participant.playerCategory}</td>
                <td>{participant.signupRole ?? "PLAYER"}</td>
                <td>{participant.confirmationStatus}</td>
                <td>{assignmentLabel}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {messageJobs && messageJobs.length > 0 && (
        <>
          <h2>Scheduled Messages</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Scheduled For</th>
                <th>Status</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {messageJobs.map((job) => (
                <tr key={job.id}>
                  <td>{job.messageType}</td>
                  <td>
                    {new Intl.DateTimeFormat("en-US", {
                      timeZone: eventTimeZone,
                      dateStyle: "short",
                      timeStyle: "short",
                    }).format(new Date(job.scheduledFor))}
                  </td>
                  <td>{job.status}</td>
                  <td>
                    {job.status === "SENT" && job.sentAt
                      ? `Sent ${new Date(job.sentAt).toLocaleString()}`
                      : job.status === "FAILED"
                        ? job.lastError ?? "Unknown error"
                        : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h2>Recent Audit</h2>
      <table className="table">
        <thead>
          <tr>
            <th>Action</th>
            <th>Actor</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          {event.auditLogs.map((log) => (
            <tr key={log.id}>
              <td>{log.action}</td>
              <td>{log.actorDiscordId}</td>
              <td>{new Date(log.createdAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
