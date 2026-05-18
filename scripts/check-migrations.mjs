import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(repoRoot, "packages/db/prisma/migrations");
const schemaPath = "packages/db/prisma/schema.prisma";
const migrationsPath = "packages/db/prisma/migrations/";
const failures = [];

if (!existsSync(migrationsDir)) {
  failures.push("packages/db/prisma/migrations is missing.");
} else {
  const migrationSqlFiles = listMigrationSqlFiles(migrationsDir);
  if (migrationSqlFiles.length === 0) {
    failures.push("No Prisma migration.sql files were found.");
  }

  for (const file of migrationSqlFiles) {
    const bytes = readFileSync(file);
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      failures.push(`${path.relative(repoRoot, file)} starts with a UTF-8 BOM.`);
    }
  }
}

const dockerignore = readFileSync(path.join(repoRoot, ".dockerignore"), "utf8");
if (!dockerignore.includes("!packages/db/prisma/migrations/**/migration.sql")) {
  failures.push(".dockerignore must re-include Prisma migration.sql files for Docker builds.");
}

const changedFiles = getChangedFiles();
if (changedFiles.has(schemaPath) && ![...changedFiles].some((file) => file.startsWith(migrationsPath))) {
  failures.push("packages/db/prisma/schema.prisma changed without a matching packages/db/prisma/migrations change.");
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Prisma migration files are present, BOM-free, and tracked with schema changes.");

function listMigrationSqlFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      results.push(...listMigrationSqlFiles(fullPath));
    } else if (entry === "migration.sql") {
      results.push(fullPath);
    }
  }
  return results;
}

function getChangedFiles() {
  const changed = new Set();
  if (!git(["rev-parse", "--is-inside-work-tree"])) return changed;

  const base = getDiffBase();
  addChangedFiles(changed, base ? ["diff", "--name-only", `${base}...HEAD`] : ["diff", "--name-only", "HEAD~1..HEAD"]);
  addChangedFiles(changed, ["diff", "--name-only"]);
  addChangedFiles(changed, ["diff", "--cached", "--name-only"]);
  return changed;
}

function getDiffBase() {
  const baseRef = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : null;
  if (baseRef) {
    const mergeBase = git(["merge-base", "HEAD", baseRef]);
    if (mergeBase) return mergeBase;
  }

  return git(["rev-parse", "--verify", "HEAD~1"]);
}

function addChangedFiles(target, args) {
  const output = git(args);
  if (!output) return;
  for (const file of output.split(/\r?\n/).filter(Boolean)) {
    target.add(file.replaceAll("\\", "/"));
  }
}

function git(args) {
  try {
    return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}
