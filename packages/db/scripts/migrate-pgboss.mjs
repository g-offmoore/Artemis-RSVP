import { PgBoss } from "pg-boss";

const rawConnectionString = process.env.PGBOSS_DATABASE_URL ?? process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
if (!rawConnectionString) {
  throw new Error("PGBOSS_DATABASE_URL, DATABASE_MIGRATION_URL, or DATABASE_URL is required for pg-boss migrations");
}

const schema = process.env.PGBOSS_SCHEMA ?? "pgboss";
const connectionString = normalizeNodePostgresConnectionString(rawConnectionString);
const boss = new PgBoss({
  connectionString,
  schema,
  max: Number.parseInt(process.env.PGBOSS_MIGRATION_POOL_MAX ?? "1", 10),
  migrate: true,
  createSchema: true,
  schedule: false,
  supervise: false
});

boss.on("error", (error) => {
  console.error(error);
});

await boss.start();
const version = await boss.schemaVersion();
await boss.stop({ close: true, graceful: false });

console.log(`pg-boss schema "${schema}" is installed at version ${version}.`);

function normalizeNodePostgresConnectionString(connectionString) {
  const url = parsePostgresUrl(connectionString);
  if (!url) return connectionString;

  const sslmode = url.searchParams.get("sslmode");
  const hasCustomCa = Boolean(url.searchParams.get("sslrootcert"));
  if ((sslmode === "require" || sslmode === "prefer") && !hasCustomCa && !url.searchParams.has("uselibpqcompat")) {
    url.searchParams.set("uselibpqcompat", "true");
  }

  return url.toString();
}

function parsePostgresUrl(connectionString) {
  try {
    const url = new URL(connectionString);
    return url.protocol === "postgresql:" || url.protocol === "postgres:" ? url : null;
  } catch {
    return null;
  }
}
