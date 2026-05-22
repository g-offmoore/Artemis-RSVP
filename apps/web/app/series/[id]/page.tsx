import Link from "next/link";
import { CalendarRange } from "lucide-react";
import { artemisApi, EventSeriesDetail, GuildSettings } from "../../../src/lib/artemis-api";
import { GenerateOccurrencesForm } from "./generate-form";

const guildId = process.env.DISCORD_GUILD_ID;

const WEEKDAY_LABELS: Record<string, string> = {
  MON: "Monday", TUE: "Tuesday", WED: "Wednesday", THU: "Thursday",
  FRI: "Friday", SAT: "Saturday", SUN: "Sunday",
};

function recurrenceLabel(rule: string) {
  const [, day] = rule.split(":");
  return `Every ${WEEKDAY_LABELS[day ?? ""] ?? day ?? rule}`;
}

function formatHour(hour: number, minute: number) {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  const ampm = hour < 12 ? "AM" : "PM";
  return `${h}:${String(minute).padStart(2, "0")} ${ampm}`;
}

export default async function SeriesDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [series, settings] = await Promise.all([
    artemisApi<EventSeriesDetail>(`/api/v1/series/${id}`),
    guildId
      ? artemisApi<GuildSettings>(`/api/v1/guild-settings?guildId=${guildId}`).catch(() => null)
      : Promise.resolve(null),
  ]);

  const eventTimeZone =
    settings?.defaultTimezone ?? process.env.ARTEMIS_EVENT_TIME_ZONE ?? "America/New_York";

  const upcomingEvents = series.events.filter(
    (e) => e.status !== "CANCELLED" && e.status !== "ARCHIVED",
  );

  return (
    <>
      <section className="page-title">
        <div>
          <Link className="muted" href="/series">
            Back to series
          </Link>
          <h1>
            <CalendarRange size={20} style={{ verticalAlign: "middle", marginRight: "0.5rem" }} />
            {series.name}
          </h1>
          <p className="muted">
            {recurrenceLabel(series.recurrenceRule)} &mdash;{" "}
            {formatHour(series.defaultStartHour, series.defaultStartMinute)},{" "}
            {series.defaultDurationMinutes / 60}h &mdash; {series.defaultGameSystem}
          </p>
        </div>
      </section>

      <section className="grid">
        <div className="stat">
          <span className="muted">Total events</span>
          <strong>{series._count.events}</strong>
        </div>
        <div className="stat">
          <span className="muted">Upcoming</span>
          <strong>{upcomingEvents.length}</strong>
        </div>
      </section>

      <section className="section-panel" aria-labelledby="generate-heading">
        <div className="section-heading">
          <div>
            <h2 id="generate-heading">Generate Occurrences</h2>
            <p className="muted">
              Creates the next N weekly events starting after the last generated occurrence.
              Each generated event uses the series defaults and can be individually edited.
            </p>
          </div>
        </div>
        <GenerateOccurrencesForm seriesId={series.id} />
      </section>

      <h2>Upcoming Events in This Series</h2>
      {upcomingEvents.length === 0 ? (
        <p className="muted">No upcoming events. Generate occurrences above.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Event</th>
              <th>Date</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {upcomingEvents.map((event) => (
              <tr key={event.id}>
                <td>
                  <Link href={`/events/${event.id}`}>{event.title}</Link>
                </td>
                <td>
                  {new Intl.DateTimeFormat("en-US", {
                    timeZone: eventTimeZone,
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(event.startAt))}
                </td>
                <td>
                  <span className="status">{event.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
