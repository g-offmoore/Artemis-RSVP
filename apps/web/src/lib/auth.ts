import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const sessionCookie = "artemis_session";

export type GuildMembership = {
  guildId: string;
  name: string;
  roles: string[];
};

export type DashboardSession = {
  discordUserId: string;
  username: string;
  avatar?: string;
  guilds: GuildMembership[];
  activeGuildId: string;
  isPlatformAdmin: boolean;
  createdAt: number;
};

export async function requireSession(): Promise<DashboardSession> {
  const session = await readSession();
  if (!session) redirect("/api/auth/login");
  return session;
}

export async function readSession(): Promise<DashboardSession | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(sessionCookie)?.value;
  if (!raw) return null;

  const [payload, signature] = raw.split(".");
  if (!payload || !signature) return null;

  const expected = sign(payload);
  if (!safeEqual(signature, expected)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return isDashboardSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * A validly-signed cookie from before a session-shape change (e.g. the old flat
 * `roles: string[]` shape, pre-multi-guild) still has a valid HMAC signature since
 * SESSION_SECRET didn't change — but it's missing fields the app now depends on
 * (activeGuildId, guilds). Without this check it parses "successfully" into a
 * DashboardSession-shaped object with undefined fields, which then crashes deep in
 * a Server Component render instead of failing closed here. Treat unrecognized
 * shapes as no session, so requireSession() sends the user back through login.
 */
export function isDashboardSession(value: unknown): value is DashboardSession {
  if (typeof value !== "object" || value === null) return false;
  const session = value as Record<string, unknown>;
  return (
    typeof session.discordUserId === "string" &&
    typeof session.activeGuildId === "string" &&
    typeof session.isPlatformAdmin === "boolean" &&
    Array.isArray(session.guilds)
  );
}

export async function writeSession(session: DashboardSession) {
  const cookieStore = await cookies();
  const payload = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  cookieStore.set(sessionCookie, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12
  });
}

export async function clearSession() {
  const cookieStore = await cookies();
  cookieStore.delete(sessionCookie);
}

/** The guild the dashboard is currently scoped to for this session. */
export function activeGuild(session: DashboardSession): GuildMembership | undefined {
  return session.guilds.find((guild) => guild.guildId === session.activeGuildId);
}

export function activeGuildRoles(session: DashboardSession): string[] {
  return activeGuild(session)?.roles ?? [];
}

/**
 * Per-guild dashboard role gate: a user needs one of that guild's own staff/admin role
 * IDs (from GuildSettings), not a single deployment-wide allowlist — each store manages
 * its own access. An empty allowlist for a guild means any member of that guild may in.
 */
export function hasAllowedRoleForGuild(
  memberRoles: string[],
  guildSettings: { staffRoleIds?: string[]; adminRoleIds?: string[] },
) {
  const allowed = [...(guildSettings.staffRoleIds ?? []), ...(guildSettings.adminRoleIds ?? [])];
  return allowed.length === 0 || memberRoles.some((role) => allowed.includes(role));
}

/** User-facing description of this guild's dashboard access gate, for empty states. */
export function guildAccessMessage(guildSettings: { staffRoleIds?: string[]; adminRoleIds?: string[] } | null) {
  const allowed = [...(guildSettings?.staffRoleIds ?? []), ...(guildSettings?.adminRoleIds ?? [])];
  if (allowed.length === 0) {
    return "All authenticated members of this guild can access dashboard and ambassador tools when no role allowlist is configured.";
  }
  return "Dashboard and ambassador tools require one of this guild's configured staff/admin Discord roles.";
}

export function configuredPlatformAdminIds() {
  return (process.env.PLATFORM_ADMIN_DISCORD_USER_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

export function isPlatformAdmin(discordUserId: string) {
  return configuredPlatformAdminIds().includes(discordUserId);
}

function sign(payload: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required");
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
