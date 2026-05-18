import { afterEach, describe, expect, it, vi } from "vitest";
import { loadEnv } from "./env.js";

describe("loadEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("treats blank optional URLs as unset", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://artemis_app:password@localhost:5432/artemis");
    vi.stubEnv("DISCORD_OPS_WEBHOOK_URL", "");
    vi.stubEnv("FEEDBACK_FORM_URL", "");

    const env = loadEnv();

    expect(env.DISCORD_OPS_WEBHOOK_URL).toBeUndefined();
    expect(env.FEEDBACK_FORM_URL).toBeUndefined();
  });
});
