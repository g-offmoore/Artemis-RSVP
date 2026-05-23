import Link from "next/link";
import { artemisApi, GuildSettings } from "../../src/lib/artemis-api";
import { SettingsForm } from "./settings-form";
import { requireSession } from "../../src/lib/auth";

const guildId = process.env.DISCORD_GUILD_ID;

export default async function SettingsPage() {
  const session = await requireSession();
  if (!guildId) {
    return <p className="error">DISCORD_GUILD_ID is not configured.</p>;
  }

  const settings = await artemisApi<GuildSettings>(
    `/api/v1/guild-settings?guildId=${guildId}`,
  ).catch(() => null);

  const hasAdminRoles = (settings?.adminRoleIds?.length ?? 0) > 0;
  const canEdit = !hasAdminRoles || (settings?.adminRoleIds ?? []).some((roleId) => session.roles.includes(roleId));

  return (
    <>
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/">Dashboard</Link>
        <span>/</span>
        <span>Settings</span>
      </nav>
      <section className="page-title">
        <h1>Guild Settings</h1>
      </section>
      {!settings && (
        <section className="empty-state-card">
          <h3>Set your defaults</h3>
          <p className="muted">
            Configure a default event channel and timezone before creating
            events.
          </p>
          <Link className="button" href="/">
            Go to dashboard quick actions
          </Link>
        </section>
      )}
      <SettingsForm settings={settings} canEdit={canEdit} currentUserId={session.discordUserId} />
    </>
  );
}
