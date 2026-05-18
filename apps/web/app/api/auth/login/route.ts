import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const clientId = required("DISCORD_CLIENT_ID");
  const redirectUri = required("DISCORD_REDIRECT_URI");
  const state = crypto.randomUUID();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "identify guilds.members.read",
    prompt: "none",
    state
  });

  const response = NextResponse.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
  response.cookies.set("artemis_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 10
  });
  return response;
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
