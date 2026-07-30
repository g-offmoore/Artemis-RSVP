import { NextResponse } from "next/server";
import { artemisApi, GuildSummary } from "../../../src/lib/artemis-api";
import { readSession } from "../../../src/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const all = await artemisApi<GuildSummary[]>("/api/v1/guilds").catch(() => []);

  const authorized = session.isPlatformAdmin
    ? all
    : all.filter((g) => session.guilds.some((sg) => sg.guildId === g.guildId));

  return NextResponse.json(authorized);
}
