import Link from "next/link";
import { artemisApi, EventDetail } from "../../../src/lib/artemis-api";
import { EventManagement } from "./event-management";

export default async function EventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const event = await artemisApi<EventDetail>(`/api/v1/events/${id}`);

  return (
    <>
      <section className="page-title">
        <div>
          <Link className="muted" href="/">
            Back to events
          </Link>
          <h1>{event.title}</h1>
          <p className="muted">
            {event.gameSystem} - {new Date(event.startAt).toLocaleString()}
          </p>
        </div>
        <span className="status">{event.status}</span>
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
        status={event.status}
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
