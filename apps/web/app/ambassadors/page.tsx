import Link from "next/link";
import { artemisApi, AmbassadorProfile } from "../../src/lib/artemis-api";
import { RegisterAmbassadorForm } from "./register-ambassador-form";

const guildId = process.env.DISCORD_GUILD_ID;

export default async function AmbassadorsPage() {
  if (!guildId) {
    return <p className="error">DISCORD_GUILD_ID is not configured.</p>;
  }

  const ambassadors = await artemisApi<AmbassadorProfile[]>(
    `/api/v1/ambassadors?guildId=${guildId}`,
  ).catch(() => [] as AmbassadorProfile[]);

  const active = ambassadors.filter((a) => a.active);
  const inactive = ambassadors.filter((a) => !a.active);

  return (
    <>
      <section className="page-title">
        <h1>Ambassadors / DMs</h1>
      </section>

      <h2>Active ({active.length})</h2>
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
              <td>{a.defaultSoftCap}/{a.defaultHardCap}</td>
              <td>{a.dmCountLast30Days}</td>
              <td>{a.backupPullCountLast90Days}</td>
              <td>{a.lastDmDate ? new Date(a.lastDmDate).toLocaleDateString() : "—"}</td>
              <td>{a._count?.tables ?? "—"}</td>
              <td>
                <Link href={`/ambassadors/${a.id}`}>Edit</Link>
              </td>
            </tr>
          ))}
          {active.length === 0 && (
            <tr>
              <td colSpan={8} className="muted">No active ambassadors.</td>
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

      <h2>Register New Ambassador</h2>
      <RegisterAmbassadorForm />
    </>
  );
}
