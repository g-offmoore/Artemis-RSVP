import { PgBoss } from "pg-boss";
import { Pool } from "pg";

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

const appDatabaseUser = process.env.DATABASE_APP_USER ?? parseDatabaseUser(process.env.APP_DATABASE_URL);
if (appDatabaseUser) {
  await grantRuntimePermissions(rawConnectionString, schema, appDatabaseUser);
  console.log(`Granted pg-boss runtime permissions on schema "${schema}" to role "${appDatabaseUser}".`);
} else {
  console.warn("APP_DATABASE_URL or DATABASE_APP_USER was not provided; skipped pg-boss runtime grants.");
}

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

function parseDatabaseUser(connectionString) {
  if (!connectionString) return null;
  const url = parsePostgresUrl(connectionString);
  return url?.username ? decodeURIComponent(url.username) : null;
}

async function grantRuntimePermissions(connectionString, schemaName, roleName) {
  const pool = new Pool({
    connectionString: normalizeNodePostgresConnectionString(connectionString),
    max: 1,
    ssl: nodePostgresSslOptions(connectionString)
  });

  const schemaIdent = quoteIdentifier(schemaName);
  const roleIdent = quoteIdentifier(roleName);
  const statements = [
    `GRANT USAGE ON SCHEMA ${schemaIdent} TO ${roleIdent}`,
    `GRANT USAGE ON TYPE ${schemaIdent}.job_state TO ${roleIdent}`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schemaIdent} TO ${roleIdent}`,
    `GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA ${schemaIdent} TO ${roleIdent}`,
    `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${schemaIdent} TO ${roleIdent}`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schemaIdent} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${roleIdent}`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schemaIdent} GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${roleIdent}`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schemaIdent} GRANT EXECUTE ON FUNCTIONS TO ${roleIdent}`
  ];

  try {
    for (const statement of statements) {
      await pool.query(statement);
    }
  } finally {
    await pool.end();
  }
}

function nodePostgresSslOptions(connectionString) {
  const url = parsePostgresUrl(connectionString);
  if (!url) return undefined;

  const sslmode = url.searchParams.get("sslmode");
  const hasCustomCa = Boolean(url.searchParams.get("sslrootcert"));
  if ((sslmode === "require" || sslmode === "prefer" || sslmode === "no-verify") && !hasCustomCa) {
    return { rejectUnauthorized: false };
  }

  return undefined;
}

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}
