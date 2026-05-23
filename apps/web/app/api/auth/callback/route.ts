import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { hasAllowedRole, writeSession } from "../../../../src/lib/auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams;
  const code = search.get("code");
  const state = search.get("state");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get("artemis_oauth_state")?.value;

  if (!code || !state || state !== expectedState) {
    return new NextResponse("Invalid OAuth state", { status: 400 });
  }

  const token = await exchangeCode(code);
  const user = await discordGet<{ id: string; username: string; avatar?: string }>("/users/@me", token.access_token);
  const member = await discordGet<{ roles: string[] }>(`/users/@me/guilds/${required("DISCORD_GUILD_ID")}/member`, token.access_token);

  if (!hasAllowedRole(member.roles)) {
    return new NextResponse("Discord account does not have a dashboard role", { status: 403 });
  }

  await writeSession({
    discordUserId: user.id,
    username: user.username,
    avatar: user.avatar,
    roles: member.roles,
    createdAt: Date.now()
  });

  const response = NextResponse.redirect(new URL("/", required("WEB_APP_URL")));
  response.cookies.delete("artemis_oauth_state");
  return response;
}

async function exchangeCode(code: string) {
  const response = await fetch("https://discord.com/api/v10/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: required("DISCORD_CLIENT_ID"),
      client_secret: required("DISCORD_CLIENT_SECRET"),
      grant_type: "authorization_code",
      code,
      redirect_uri: required("DISCORD_REDIRECT_URI")
    })
  });
  if (!response.ok) throw new Error(`Discord token exchange failed: ${response.status}`);
  return response.json() as Promise<{ access_token: string }>;
}

async function discordGet<T>(path: string, accessToken: string): Promise<T> {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    headers: { authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) throw new Error(`Discord API failed: ${path} ${response.status}`);
  return response.json() as Promise<T>;
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
