import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  Repeat,
  Settings,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import {
  artemisApi,
  EventSummary,
  GuildSettings,
} from "../src/lib/artemis-api";
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

      <section className="section-panel" aria-label="Quick actions">
        <div className="section-heading">
          <div>
            <h2>Quick Actions</h2>
            <p className="muted">
              Common admin tasks to get your scheduling workflow started.
            </p>
          </div>
        </div>
        <div className="quick-actions">
          <Link className="action-card" href="#create-event">
            <CalendarDays size={18} />
            <strong>Create one-time event</strong>
          </Link>
          <Link className="action-card" href="/series/new">
            <Repeat size={18} />
            <strong>Create recurring series</strong>
          </Link>
          <Link className="action-card" href="/calendar">
            <ArrowRight size={18} />
            <strong>Open calendar</strong>
          </Link>
          <Link className="action-card" href="/settings">
            <Settings size={18} />
            <strong>Configure default channel/timezone</strong>
          </Link>
        </div>
      </section>

      <section className="section-panel" aria-label="Ambassador management">
        <div className="section-heading">
          <div>
            <h2>Ambassador Management</h2>
            <p className="muted">
              Assign, track, and maintain ambassador profiles used for table
              planning.
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
      <div id="create-event">
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
      </div>

      <section id="calendar" className="section-panel">
        <div className="section-heading">
          <div>
            <h2>Calendar</h2>
            <p className="muted">
              View upcoming schedules and fill in event coverage gaps.
            </p>
          </div>
          <Link className="button secondary" href="/calendar">
            Open full calendar
          </Link>
        </div>
      </section>

      <h2 id="upcoming-events">Upcoming Events</h2>
      {events.length === 0 && (
        <section className="empty-state-card">
          <h3>Get started with event operations</h3>
          <p className="muted">
            Use quick actions above to create an event, set up recurring series,
            and configure defaults.
          </p>
          <div className="empty-state-actions">
            <Link className="button" href="#create-event">
              Create one-time event
            </Link>
            <Link className="button secondary" href="/series/new">
              Create recurring series
            </Link>
          </div>
        </section>
      )}
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
                No events yet. Create your first event above, then use{" "}
                <Link href="/ambassadors">Ambassadors</Link> to register
                available DMs before table assignments.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
