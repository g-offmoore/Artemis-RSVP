import { describe, expect, it } from "vitest";
import { nodePostgresSslOptions, normalizeNodePostgresConnectionString } from "./index.js";

describe("node-postgres connection string helpers", () => {
  it("adds libpq-compatible SSL behavior for managed Postgres sslmode=require URLs", () => {
    const normalized = normalizeNodePostgresConnectionString(
      "postgresql://artemis_app:password@example.com:5432/artemis?sslmode=require&connection_limit=5"
    );

    expect(normalized).toContain("sslmode=require");
    expect(normalized).toContain("connection_limit=5");
    expect(normalized).toContain("uselibpqcompat=true");
    expect(nodePostgresSslOptions(normalized)).toEqual({ rejectUnauthorized: false });
  });

  it("does not weaken verify-full URLs", () => {
    const raw = "postgresql://artemis_app:password@example.com:5432/artemis?sslmode=verify-full";

    expect(normalizeNodePostgresConnectionString(raw)).toBe(raw);
    expect(nodePostgresSslOptions(raw)).toBeUndefined();
  });
});
