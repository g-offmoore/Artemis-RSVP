import Link from "next/link";
import { artemisApi, GuildSettings } from "../../src/lib/artemis-api";
import { SettingsForm } from "./settings-form";
import { activeGuildRoles, requireSession } from "../../src/lib/auth";

export default async function SettingsPage() {
  const session = await requireSession();
  const guildId = session.activeGuildId;

  const settings = await artemisApi<GuildSettings>(
    `/api/v1/guild-settings?guildId=${guildId}`,
    { guildId },
  ).catch(() => null);

  const hasAdminRoles = (settings?.adminRoleIds?.length ?? 0) > 0;
  const canEdit =
    session.isPlatformAdmin ||
    !hasAdminRoles ||
    (settings?.adminRoleIds ?? []).some((roleId) => activeGuildRoles(session).includes(roleId));

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
      <SettingsForm settings={settings} canEdit={canEdit} currentUserId={session.discordUserId} guildId={guildId} />
    </>
  );
}
