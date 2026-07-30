import { NextRequest, NextResponse } from "next/server";
import { artemisApi, ChannelSummary } from "../../../../../src/lib/artemis-api";
import { readSession } from "../../../../../src/lib/auth";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params;
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isAuthorized =
    session.isPlatformAdmin ||
    session.guilds.some((g) => g.guildId === guildId);
  if (!isAuthorized) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const channels = await artemisApi<ChannelSummary[]>(
      `/api/v1/guilds/${encodeURIComponent(guildId)}/channels`,
      { guildId },
    );
    return NextResponse.json(channels);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 502 });
  }
}
