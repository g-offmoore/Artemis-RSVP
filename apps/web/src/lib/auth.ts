import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const sessionCookie = "artemis_session";

export type DashboardSession = {
  discordUserId: string;
  username: string;
  avatar?: string;
  roles: string[];
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
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as DashboardSession;
  } catch {
    return null;
  }
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

export function hasAllowedRole(roles: string[]) {
  const allowed = (process.env.DASHBOARD_ALLOWED_ROLE_IDS ?? "")
    .split(",")
    .map((role) => role.trim())
    .filter(Boolean);

  return allowed.length === 0 || roles.some((role) => allowed.includes(role));
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
