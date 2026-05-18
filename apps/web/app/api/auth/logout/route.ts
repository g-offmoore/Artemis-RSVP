import { NextRequest, NextResponse } from "next/server";
import { clearSession } from "../../../../src/lib/auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  await clearSession();
  return NextResponse.redirect(new URL("/api/auth/login", request.url));
}
