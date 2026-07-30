import { afterEach, describe, expect, it, vi } from "vitest";
import { loadEnv } from "./env.js";

describe("loadEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("treats blank optional URLs as unset", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://artemis_app:password@localhost:5432/artemis");
    vi.stubEnv("INTERNAL_API_TOKEN", "a-sufficiently-long-test-secret");
    vi.stubEnv("DISCORD_OPS_WEBHOOK_URL", "");

    const env = loadEnv();

    expect(env.DISCORD_OPS_WEBHOOK_URL).toBeUndefined();
  });

  it("fails closed when INTERNAL_API_TOKEN is missing", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://artemis_app:password@localhost:5432/artemis");
    vi.stubEnv("INTERNAL_API_TOKEN", "");

    expect(() => loadEnv()).toThrow(/INTERNAL_API_TOKEN/);
  });
});
