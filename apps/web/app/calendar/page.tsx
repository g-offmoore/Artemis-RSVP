import { CalendarView } from "./calendar-view";
import { artemisApi, EventSummary } from "../../src/lib/artemis-api";
import { requireSession } from "../../src/lib/auth";

export default async function CalendarPage() {
  const session = await requireSession();
  const guildId = session.activeGuildId;
  const events = await artemisApi<EventSummary[]>(`/api/v1/events?guildId=${guildId}`, { guildId });

  return <CalendarView events={events} />;
}
