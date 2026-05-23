import { CalendarView } from "./calendar-view";
import { artemisApi, EventSummary } from "../../src/lib/artemis-api";

export default async function CalendarPage() {
  const guildId = process.env.DISCORD_GUILD_ID;
  const events = guildId
    ? await artemisApi<EventSummary[]>(`/api/v1/events?guildId=${guildId}`)
    : [];

  return <CalendarView events={events} />;
}
