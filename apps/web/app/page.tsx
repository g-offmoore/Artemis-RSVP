import Link from "next/link";
import { ArrowRight, CalendarDays, ShieldCheck, UsersRound } from "lucide-react";
import { artemisApi, EventSummary, GuildSettings } from "../src/lib/artemis-api";
import { allowedRoleAccessMessage } from "../src/lib/auth";
import { EventCreateForm } from "./event-create-form";

export default async function DashboardPage() {
  const guildId = process.env.DISCORD_GUILD_ID;
  const [events, settings] = await Promise.all([
    guildId
      ? artemisApi<EventSummary[]>(`/api/v1/events?guildId=${guildId}`)
      : Promise.resolve([] as EventSummary[]),
    guildId
      ? artemisApi<GuildSettings>(
          `/api/v1/guild-settings?guildId=${guildId}`,
        ).catch(() => null)
      : Promise.resolve(null),
  ]);

  const roleAccessMessage = allowedRoleAccessMessage();

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


      <section className="section-panel" aria-label="Ambassador management">
        <div className="section-heading">
          <div>
            <h2>Ambassador Management</h2>
            <p className="muted">
              Assign, track, and maintain ambassador profiles used for table planning.
            </p>
          </div>
          <Link className="button secondary" href="/ambassadors">
            Open Ambassador Tools <ArrowRight size={16} />
          </Link>
        </div>
        <p className="muted role-note">
          <ShieldCheck size={16} />
          {roleAccessMessage}
        </p>
      </section>
      <EventCreateForm
        defaultChannelId={
          settings?.defaultEventChannelId ??
          process.env.DISCORD_EVENT_CHANNEL_ID
        }
        defaultTimezone={
          settings?.defaultTimezone ??
          process.env.ARTEMIS_EVENT_TIME_ZONE ??
          "America/New_York"
        }
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
          {events.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">
                No events yet. Create your first event above, then use <Link href="/ambassadors">Ambassadors</Link> to register available DMs before table assignments.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
