import { NextResponse } from "next/server";

export const runtime = "nodejs";

const requiredEnv = [
  "SESSION_SECRET",
  "DISCORD_CLIENT_ID",
  "DISCORD_CLIENT_SECRET",
  "DISCORD_REDIRECT_URI",
  "DISCORD_GUILD_ID",
  "DASHBOARD_ALLOWED_ROLE_IDS",
  "INTERNAL_API_TOKEN"
];

export async function GET() {
  const missing = requiredEnv.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    return NextResponse.json({ ok: false, missing }, { status: 500 });
  }

  return NextResponse.json({ ok: true, service: "artemis-web" });
}
