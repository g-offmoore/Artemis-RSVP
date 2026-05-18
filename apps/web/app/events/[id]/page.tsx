import Link from "next/link";
import { artemisApi, EventDetail, GuildSettings } from "../../../src/lib/artemis-api";
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
  const [event, settings] = await Promise.all([
    artemisApi<EventDetail>(`/api/v1/events/${id}`),
    guildId
      ? artemisApi<GuildSettings>(
          `/api/v1/guild-settings?guildId=${guildId}`,
        ).catch(() => null)
      : Promise.resolve(null),
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
          <span className="muted">Assignments</span>
          <strong>
            {
              event.assignments.filter(
                (assignment) => assignment.status === "ASSIGNED",
              ).length
            }
          </strong>
        </div>
      </section>

      {event.imageUrl ? (
        <img className="event-graphic" src={event.imageUrl} alt="" />
      ) : null}

      <EventManagement
        eventId={event.id}
        gameSystem={event.gameSystem}
        messageId={event.messageId}
        status={event.status}
      />

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
            <th>Type</th>
            <th>Capacity</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {event.tables.map((table) => (
            <tr key={table.id}>
              <td>{table.title}</td>
              <td>{table.tableType}</td>
              <td>
                {table.softCap}/{table.hardCap}
              </td>
              <td>{table.status}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Participants</h2>
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Category</th>
            <th>Attendance</th>
            <th>Assignment</th>
          </tr>
        </thead>
        <tbody>
          {event.participants.map((participant) => {
            const assignment = event.assignments.find(
              (item) =>
                item.eventParticipantId === participant.id &&
                item.status === "ASSIGNED",
            );
            const table = event.tables.find(
              (item) => item.id === assignment?.eventTableId,
            );
            return (
              <tr key={participant.id}>
                <td>{participant.displayName}</td>
                <td>{participant.participantType}</td>
                <td>{participant.playerCategory}</td>
                <td>{participant.confirmationStatus}</td>
                <td>{table?.title ?? "Unassigned"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

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
