import { builtinModules } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const builtinNames = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);

const workspaces = [
  {
    name: "@artemis/api",
    packageJson: "apps/api/package.json",
    roots: ["apps/api/src"]
  },
  {
    name: "@artemis/web",
    packageJson: "apps/web/package.json",
    roots: ["apps/web/app", "apps/web/src", "apps/web/next.config.mjs"]
  },
  {
    name: "@artemis/bot",
    packageJson: "apps/bot/package.json",
    roots: ["apps/bot/src"]
  },
  {
    name: "@artemis/db",
    packageJson: "packages/db/package.json",
    roots: ["packages/db/src", "packages/db/prisma.config.ts"]
  },
  {
    name: "@artemis/domain",
    packageJson: "packages/domain/package.json",
    roots: ["packages/domain/src"]
  }
];

const failures = [];

for (const workspace of workspaces) {
  const manifest = readJson(workspace.packageJson);
  const runtimeDeps = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {})
  ]);
  const toolDeps = new Set([...runtimeDeps, ...Object.keys(manifest.devDependencies ?? {})]);

  for (const file of workspace.roots.flatMap((root) => listSourceFiles(path.join(repoRoot, root)))) {
    const imports = findImports(file);
    const allowToolDeps = file.endsWith(path.normalize("packages/db/prisma.config.ts"));
    const declared = allowToolDeps ? toolDeps : runtimeDeps;

    for (const specifier of imports) {
      const packageName = getPackageName(specifier);
      if (!packageName) continue;

      if (!declared.has(packageName)) {
        failures.push(`${workspace.name}: ${path.relative(repoRoot, file)} imports "${specifier}" but ${packageName} is not declared in dependencies`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Runtime import declarations are complete.");

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(repoRoot, relativePath), "utf8"));
}

function listSourceFiles(target) {
  if (!exists(target)) return [];

  const stats = statSync(target);
  if (stats.isFile()) {
    return isSourceFile(target) ? [target] : [];
  }

  const files = [];
  for (const entry of readdirSync(target)) {
    const fullPath = path.join(target, entry);
    const relative = path.relative(repoRoot, fullPath).replaceAll(path.sep, "/");
    if (
      relative.includes("/dist/") ||
      relative.includes("/.next/") ||
      relative.includes("/generated/") ||
      relative.endsWith(".test.ts") ||
      relative.endsWith(".test.tsx") ||
      relative.endsWith("next-env.d.ts")
    ) {
      continue;
    }

    const entryStats = statSync(fullPath);
    if (entryStats.isDirectory()) {
      files.push(...listSourceFiles(fullPath));
    } else if (isSourceFile(fullPath)) {
      files.push(fullPath);
    }
  }

  return files;
}

function exists(target) {
  try {
    statSync(target);
    return true;
  } catch {
    return false;
  }
}

function isSourceFile(file) {
  return /\.(cjs|mjs|js|jsx|ts|tsx)$/.test(file);
}

function findImports(file) {
  const sourceText = readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);
  const imports = new Set();

  visit(sourceFile);
  return imports;

  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.add(node.moduleSpecifier.text);
    }

    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      imports.add(node.arguments[0].text);
    }

    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require" &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      imports.add(node.arguments[0].text);
    }

    ts.forEachChild(node, visit);
  }
}

function getPackageName(specifier) {
  if (specifier.startsWith(".") || specifier.startsWith("/") || builtinNames.has(specifier)) return null;

  const bareSpecifier = specifier.startsWith("node:") ? specifier.slice("node:".length) : specifier;
  if (builtinNames.has(bareSpecifier)) return null;

  const parts = specifier.split("/");
  return specifier.startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
}
