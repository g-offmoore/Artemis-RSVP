import Link from "next/link";
import { artemisApi, GuildSettings } from "../../../src/lib/artemis-api";
import { requireSession } from "../../../src/lib/auth";
import { SeriesCreateForm } from "./series-create-form";

export default async function NewSeriesPage() {
  const session = await requireSession();
  const guildId = session.activeGuildId;
  const settings = await artemisApi<GuildSettings>(
    `/api/v1/guild-settings?guildId=${guildId}`,
    { guildId },
  ).catch(() => null);

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
          settings?.defaultEventChannelId ??
          process.env.DISCORD_EVENT_CHANNEL_ID
        }
        defaultTimezone={
          settings?.defaultTimezone ?? process.env.ARTEMIS_EVENT_TIME_ZONE
        }
      />
    </>
  );
}
