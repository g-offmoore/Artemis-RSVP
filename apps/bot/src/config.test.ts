import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("normalizes blank optional values", () => {
    vi.stubEnv("DISCORD_TOKEN", "discord-token");
    vi.stubEnv("API_URL", "");
    vi.stubEnv("API_INTERNAL_URL", "api:3000");
    vi.stubEnv("DISCORD_OPS_WEBHOOK_URL", "");

    const config = loadConfig();

    expect(config.API_URL).toBe("http://api:3000");
    expect(config.DISCORD_OPS_WEBHOOK_URL).toBeUndefined();
  });

  it("loads without a guild id configured (multi-guild: guild comes from each interaction)", () => {
    vi.stubEnv("DISCORD_TOKEN", "discord-token");
    vi.stubEnv("DISCORD_GUILD_ID", "");
    vi.stubEnv("API_URL", "http://api:3000");

    const config = loadConfig();

    expect(config).not.toHaveProperty("DISCORD_GUILD_ID");
  });
});
