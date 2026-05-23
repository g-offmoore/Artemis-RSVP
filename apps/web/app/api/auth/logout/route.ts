import { NextResponse } from "next/server";
import { clearSession } from "../../../../src/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  await clearSession();
  return NextResponse.redirect(new URL("/api/auth/login", required("WEB_APP_URL")));
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
