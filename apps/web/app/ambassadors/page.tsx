import Link from "next/link";
import { artemisApi, AmbassadorProfile, GuildSettings } from "../../src/lib/artemis-api";
import { RegisterAmbassadorForm } from "./register-ambassador-form";
import { guildAccessMessage, requireSession } from "../../src/lib/auth";

export default async function AmbassadorsPage() {
  const session = await requireSession();
  const guildId = session.activeGuildId;

  const [ambassadors, settings] = await Promise.all([
    artemisApi<AmbassadorProfile[]>(
      `/api/v1/ambassadors?guildId=${guildId}`,
      { guildId },
    ).catch(() => [] as AmbassadorProfile[]),
    artemisApi<GuildSettings>(`/api/v1/guild-settings?guildId=${guildId}`, { guildId }).catch(() => null),
  ]);

  const roleAccessMessage = guildAccessMessage(settings);

  const active = ambassadors.filter((a) => a.active);
  const inactive = ambassadors.filter((a) => !a.active);

  return (
    <>
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/">Dashboard</Link>
        <span>/</span>
        <span>Ambassadors</span>
      </nav>
      <section className="page-title">
        <div>
          <h1>Ambassadors / DMs</h1>
          <p className="muted">{roleAccessMessage}</p>
        </div>
      </section>

      <h2>Active ({active.length})</h2>
      {active.length === 0 && (
        <section className="empty-state-card">
          <h3>No active ambassadors yet</h3>
          <p className="muted">
            Add ambassador/DM profiles so event tables can be staffed
            immediately.
          </p>
          <a className="button" href="#register-ambassador">
            Register ambassador
          </a>
        </section>
      )}
      <table className="table">
        <thead>
          <tr>
            <th>Display Name</th>
            <th>Game Systems</th>
            <th>Cap (soft/hard)</th>
            <th>DMs (30d)</th>
            <th>Backup Pulls (90d)</th>
            <th>Last DM</th>
            <th>Tables</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {active.map((a) => (
            <tr key={a.id}>
              <td>{a.displayName}</td>
              <td>{a.supportedGameSystems.join(", ") || "—"}</td>
              <td>
                {a.defaultSoftCap}/{a.defaultHardCap}
              </td>
              <td>{a.dmCountLast30Days}</td>
              <td>{a.backupPullCountLast90Days}</td>
              <td>
                {a.lastDmDate
                  ? new Date(a.lastDmDate).toLocaleDateString()
                  : "—"}
              </td>
              <td>{a._count?.tables ?? "—"}</td>
              <td>
                <Link href={`/ambassadors/${a.id}`}>Edit</Link>
              </td>
            </tr>
          ))}
          {active.length === 0 && (
            <tr>
              <td colSpan={8} className="muted">
                No active ambassadors. Register your first ambassador below so
                events can assign tables to active DMs.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {inactive.length > 0 && (
        <>
          <h2>Inactive ({inactive.length})</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Display Name</th>
                <th>Discord User ID</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {inactive.map((a) => (
                <tr key={a.id}>
                  <td>{a.displayName}</td>
                  <td className="muted">{a.discordUserId}</td>
                  <td>
                    <Link href={`/ambassadors/${a.id}`}>Edit</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h2 id="register-ambassador">Register New Ambassador</h2>
      <RegisterAmbassadorForm />
    </>
  );
}
