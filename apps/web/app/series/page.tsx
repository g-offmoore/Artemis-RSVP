import Link from "next/link";
import { CalendarRange, Plus } from "lucide-react";
import { artemisApi, EventSeriesSummary } from "../../src/lib/artemis-api";

const guildId = process.env.DISCORD_GUILD_ID;

const WEEKDAY_LABELS: Record<string, string> = {
  MON: "Monday",
  TUE: "Tuesday",
  WED: "Wednesday",
  THU: "Thursday",
  FRI: "Friday",
  SAT: "Saturday",
  SUN: "Sunday",
};

function recurrenceLabel(rule: string) {
  const [, day] = rule.split(":");
  return `Every ${WEEKDAY_LABELS[day ?? ""] ?? day ?? rule}`;
}

export default async function SeriesPage() {
  const seriesList = guildId
    ? await artemisApi<EventSeriesSummary[]>(
        `/api/v1/series?guildId=${guildId}`,
      ).catch(() => [] as EventSeriesSummary[])
    : ([] as EventSeriesSummary[]);

  return (
    <>
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/">Dashboard</Link>
        <span>/</span>
        <span>Series</span>
      </nav>
      <section className="page-title">
        <div>
          <h1>Recurring Series</h1>
          <p className="muted">
            Weekly event templates and their generated occurrences.
          </p>
        </div>
        <Link className="button" href="/series/new">
          <Plus size={16} />
          New series
        </Link>
      </section>

      {seriesList.length === 0 ? (
        <section className="empty-state-card">
          <h3>No series configured</h3>
          <p className="muted">
            Create a recurring template to automatically generate weekly events.
          </p>
          <Link className="button" href="/series/new">
            Create recurring series
          </Link>
        </section>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Series</th>
              <th>Schedule</th>
              <th>Game</th>
              <th>Events</th>
            </tr>
          </thead>
          <tbody>
            {seriesList.map((s) => (
              <tr key={s.id}>
                <td>
                  <Link href={`/series/${s.id}`}>
                    <CalendarRange
                      size={14}
                      style={{ verticalAlign: "middle", marginRight: "0.4rem" }}
                    />
                    {s.name}
                  </Link>
                  <div className="muted" style={{ fontSize: "0.75rem" }}>
                    {s.id}
                  </div>
                </td>
                <td>{recurrenceLabel(s.recurrenceRule)}</td>
                <td>{s.defaultGameSystem}</td>
                <td>{s._count.events}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
