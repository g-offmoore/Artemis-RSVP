import { NextRequest, NextResponse } from "next/server";
import { readSession, writeSession } from "../../../../src/lib/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const session = await readSession();
  if (!session) {
    return NextResponse.redirect(new URL("/api/auth/login", request.url));
  }

  const formData = await request.formData();
  const guildId = String(formData.get("guildId") ?? "");
  const redirectTo = String(formData.get("redirectTo") ?? "/");

  const allowed = session.guilds.some((guild) => guild.guildId === guildId);
  if (allowed) {
    await writeSession({ ...session, activeGuildId: guildId });
  }

  return NextResponse.redirect(new URL(redirectTo, request.url));
}
