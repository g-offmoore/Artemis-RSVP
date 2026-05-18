import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

export { PrismaClient };
export type { Prisma } from "./generated/prisma/client.js";

export type PrismaPoolOptions = {
  connectionString?: string;
  max?: number;
  sslRejectUnauthorized?: boolean;
  logQueries?: boolean;
};

export function createPrismaClient(options: PrismaPoolOptions = {}) {
  const rawConnectionString = options.connectionString ?? process.env.DATABASE_URL;
  if (!rawConnectionString) {
    throw new Error("DATABASE_URL is required");
  }

  const connectionString = normalizeNodePostgresConnectionString(rawConnectionString);
  const max = options.max ?? parsePositiveInt(process.env.DATABASE_POOL_MAX, 5);
  const adapter = new PrismaPg({
    connectionString,
    max,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 60_000,
    ssl: nodePostgresSslOptions(rawConnectionString, options.sslRejectUnauthorized)
  });

  return new PrismaClient({
    adapter,
    log: options.logQueries ? ["query", "warn", "error"] : ["warn", "error"]
  });
}

export function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function normalizeNodePostgresConnectionString(connectionString: string): string {
  const url = parsePostgresUrl(connectionString);
  if (!url) return connectionString;

  const sslmode = url.searchParams.get("sslmode");
  const hasCustomCa = Boolean(url.searchParams.get("sslrootcert"));
  if ((sslmode === "require" || sslmode === "prefer") && !hasCustomCa && !url.searchParams.has("uselibpqcompat")) {
    url.searchParams.set("uselibpqcompat", "true");
  }

  return url.toString();
}

export function nodePostgresSslOptions(
  connectionString: string,
  rejectUnauthorized = false
): { rejectUnauthorized: boolean } | undefined {
  const url = parsePostgresUrl(connectionString);
  if (!url) return undefined;

  const sslmode = url.searchParams.get("sslmode");
  const hasCustomCa = Boolean(url.searchParams.get("sslrootcert"));
  if ((sslmode === "require" || sslmode === "prefer" || sslmode === "no-verify") && !hasCustomCa) {
    return { rejectUnauthorized };
  }

  return undefined;
}

function parsePostgresUrl(connectionString: string): URL | null {
  try {
    const url = new URL(connectionString);
    return url.protocol === "postgresql:" || url.protocol === "postgres:" ? url : null;
  } catch {
    return null;
  }
}
