import Link from "next/link";
import { artemisApi, GuildSettings } from "../../../src/lib/artemis-api";
import { SeriesCreateForm } from "./series-create-form";

const guildId = process.env.DISCORD_GUILD_ID;

export default async function NewSeriesPage() {
  const settings = guildId
    ? await artemisApi<GuildSettings>(`/api/v1/guild-settings?guildId=${guildId}`).catch(() => null)
    : null;

  return (
    <>
      <section className="page-title">
        <div>
          <Link className="muted" href="/series">
            Back to series
          </Link>
          <h1>New Weekly Series</h1>
        </div>
      </section>

      <SeriesCreateForm
        defaultChannelId={
          settings?.defaultEventChannelId ?? process.env.DISCORD_EVENT_CHANNEL_ID
        }
      />
    </>
  );
}
