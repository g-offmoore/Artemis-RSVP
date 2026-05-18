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
  const connectionString = options.connectionString ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  const max = options.max ?? parsePositiveInt(process.env.DATABASE_POOL_MAX, 5);
  const adapter = new PrismaPg({
    connectionString,
    max,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 60_000,
    ssl: connectionString.includes("sslmode=require")
      ? { rejectUnauthorized: options.sslRejectUnauthorized ?? false }
      : undefined
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
