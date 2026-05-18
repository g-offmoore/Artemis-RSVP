import Link from "next/link";
import { CalendarDays, UsersRound } from "lucide-react";
import { artemisApi, EventSummary } from "../src/lib/artemis-api";
import { EventCreateForm } from "./event-create-form";

export default async function DashboardPage() {
  const guildId = process.env.DISCORD_GUILD_ID;
  const events = guildId
    ? await artemisApi<EventSummary[]>(`/api/v1/events?guildId=${guildId}`)
    : [];

  const totalParticipants = events.reduce(
    (sum, event) => sum + (event._count?.participants ?? 0),
    0,
  );
  const totalTables = events.reduce(
    (sum, event) => sum + (event._count?.tables ?? 0),
    0,
  );

  return (
    <>
      <section className="page-title">
        <div>
          <h1>Event Operations</h1>
          <p className="muted">
            Upcoming event state, table coverage, and RSVP pressure.
          </p>
        </div>
      </section>

      <section className="grid" aria-label="Summary metrics">
        <div className="stat">
          <CalendarDays size={20} />
          <span className="muted">Upcoming events</span>
          <strong>{events.length}</strong>
        </div>
        <div className="stat">
          <UsersRound size={20} />
          <span className="muted">Expected participants</span>
          <strong>{totalParticipants}</strong>
        </div>
        <div className="stat">
          <span className="muted">Registered tables</span>
          <strong>{totalTables}</strong>
        </div>
      </section>

      <EventCreateForm
        defaultChannelId={process.env.DISCORD_EVENT_CHANNEL_ID}
      />

      <h2>Upcoming Events</h2>
      <table className="table">
        <thead>
          <tr>
            <th>Event</th>
            <th>Game</th>
            <th>Status</th>
            <th>When</th>
            <th>Participants</th>
            <th>Tables</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id}>
              <td>
                <Link href={`/events/${event.id}`}>{event.title}</Link>
                <div className="muted">{event.id}</div>
              </td>
              <td>{event.gameSystem}</td>
              <td>
                <span className="status">{event.status}</span>
              </td>
              <td>{new Date(event.startAt).toLocaleString()}</td>
              <td>{event._count?.participants ?? 0}</td>
              <td>{event._count?.tables ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
