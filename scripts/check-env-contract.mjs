import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envExample = ".env.production.example";
const composeFile = "docker-compose.yml";
const envText = read(envExample);
const composeText = read(composeFile);

const documented = new Set(
  envText
    .split(/\r?\n/)
    .map((line) => line.match(/^([A-Z0-9_]+)=/i)?.[1])
    .filter(Boolean)
);

const referenced = new Set();
const variablePattern = /\$\{([A-Z0-9_]+)(?::[-?][^}]*)?\}/gi;
for (const match of composeText.matchAll(variablePattern)) {
  referenced.add(match[1]);
}

const missing = [...referenced].filter((name) => !documented.has(name));
const bannedAliases = [
  "NEXTAUTH_SECRET",
  "DISCORD_BOT_TOKEN",
  "MIGRATION_DATABASE_URL",
  "API_INTERNAL_TOKEN",
  "APP_BASE_URL",
  "API_DATABASE_POOL_MAX"
];
const filesToCheck = [envExample, ".env.example", composeFile, "README.md"];
const stale = [];

for (const file of filesToCheck) {
  const text = read(file);
  for (const alias of bannedAliases) {
    if (text.includes(alias)) {
      stale.push(`${file} contains stale alias ${alias}`);
    }
  }
}

if (missing.length > 0 || stale.length > 0) {
  if (missing.length > 0) {
    console.error(`Variables referenced by ${composeFile} but missing from ${envExample}: ${missing.join(", ")}`);
  }
  if (stale.length > 0) {
    console.error(stale.join("\n"));
  }
  process.exit(1);
}

console.log("Docker Compose env contract matches .env.production.example.");

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}
