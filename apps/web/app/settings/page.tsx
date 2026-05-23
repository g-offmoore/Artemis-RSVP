import { artemisApi, GuildSettings } from "../../src/lib/artemis-api";
import { SettingsForm } from "./settings-form";

const guildId = process.env.DISCORD_GUILD_ID;

export default async function SettingsPage() {
  if (!guildId) {
    return <p className="error">DISCORD_GUILD_ID is not configured.</p>;
  }

  const settings = await artemisApi<GuildSettings>(
    `/api/v1/guild-settings?guildId=${guildId}`,
  ).catch(() => null);

  return (
    <>
      <section className="page-title">
        <h1>Guild Settings</h1>
      </section>
      <SettingsForm settings={settings} />
    </>
  );
}
