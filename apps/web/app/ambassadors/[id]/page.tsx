import Link from "next/link";
import { artemisApi, AmbassadorProfile } from "../../../src/lib/artemis-api";
import { EditAmbassadorForm } from "./edit-ambassador-form";

export default async function AmbassadorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ambassador = await artemisApi<AmbassadorProfile>(`/api/v1/ambassadors/${id}`);

  return (
    <>
      <section className="page-title">
        <div>
          <Link className="muted" href="/ambassadors">
            Back to ambassadors
          </Link>
          <h1>{ambassador.displayName}</h1>
          <p className="muted">
            Discord: {ambassador.discordUserId} &mdash;{" "}
            <span className={ambassador.active ? "status" : "muted"}>
              {ambassador.active ? "Active" : "Inactive"}
            </span>
          </p>
        </div>
      </section>

      <section className="grid">
        <div className="stat">
          <span className="muted">DMs (30d)</span>
          <strong>{ambassador.dmCountLast30Days}</strong>
        </div>
        <div className="stat">
          <span className="muted">Backup Pulls (90d)</span>
          <strong>{ambassador.backupPullCountLast90Days}</strong>
        </div>
        <div className="stat">
          <span className="muted">Last DM</span>
          <strong style={{ fontSize: "0.85rem" }}>
            {ambassador.lastDmDate ? new Date(ambassador.lastDmDate).toLocaleDateString() : "—"}
          </strong>
        </div>
        <div className="stat">
          <span className="muted">Tables</span>
          <strong>{ambassador._count?.tables ?? "—"}</strong>
        </div>
      </section>

      <h2>Edit Profile</h2>
      <EditAmbassadorForm ambassador={ambassador} />
    </>
  );
}
