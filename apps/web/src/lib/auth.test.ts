import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activeGuild,
  activeGuildRoles,
  configuredPlatformAdminIds,
  DashboardSession,
  guildAccessMessage,
  hasAllowedRoleForGuild,
  isPlatformAdmin,
} from "./auth.js";

function makeSession(overrides: Partial<DashboardSession> = {}): DashboardSession {
  return {
    discordUserId: "u1",
    username: "tester",
    guilds: [
      { guildId: "g1", name: "Guild One", roles: ["role-staff"] },
      { guildId: "g2", name: "Guild Two", roles: [] },
    ],
    activeGuildId: "g1",
    isPlatformAdmin: false,
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("hasAllowedRoleForGuild", () => {
  it("allows any member when the guild has no configured allowlist", () => {
    expect(hasAllowedRoleForGuild([], {})).toBe(true);
    expect(hasAllowedRoleForGuild(["whatever"], { staffRoleIds: [], adminRoleIds: [] })).toBe(true);
  });

  it("allows a member with a matching staff role", () => {
    expect(hasAllowedRoleForGuild(["role-a"], { staffRoleIds: ["role-a"], adminRoleIds: [] })).toBe(true);
  });

  it("allows a member with a matching admin role", () => {
    expect(hasAllowedRoleForGuild(["role-b"], { staffRoleIds: [], adminRoleIds: ["role-b"] })).toBe(true);
  });

  it("rejects a member with none of the configured roles", () => {
    expect(hasAllowedRoleForGuild(["role-c"], { staffRoleIds: ["role-a"], adminRoleIds: ["role-b"] })).toBe(false);
  });
});

describe("platform admin allowlist", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is empty by default", () => {
    vi.stubEnv("PLATFORM_ADMIN_DISCORD_USER_IDS", "");
    expect(configuredPlatformAdminIds()).toEqual([]);
    expect(isPlatformAdmin("anyone")).toBe(false);
  });

  it("parses a comma-separated list and matches membership", () => {
    vi.stubEnv("PLATFORM_ADMIN_DISCORD_USER_IDS", " 111, 222 ,333");
    expect(configuredPlatformAdminIds()).toEqual(["111", "222", "333"]);
    expect(isPlatformAdmin("222")).toBe(true);
    expect(isPlatformAdmin("444")).toBe(false);
  });
});

describe("activeGuild / activeGuildRoles", () => {
  it("finds the guild matching activeGuildId", () => {
    const session = makeSession();
    expect(activeGuild(session)?.guildId).toBe("g1");
    expect(activeGuildRoles(session)).toEqual(["role-staff"]);
  });

  it("returns an empty roles array when active guild isn't in the session's guild list", () => {
    const session = makeSession({ activeGuildId: "missing" });
    expect(activeGuild(session)).toBeUndefined();
    expect(activeGuildRoles(session)).toEqual([]);
  });
});

describe("guildAccessMessage", () => {
  it("describes open access when no roles are configured", () => {
    expect(guildAccessMessage(null)).toMatch(/all authenticated members/i);
    expect(guildAccessMessage({ staffRoleIds: [], adminRoleIds: [] })).toMatch(/all authenticated members/i);
  });

  it("describes gated access when roles are configured", () => {
    expect(guildAccessMessage({ staffRoleIds: ["r1"], adminRoleIds: [] })).toMatch(/configured staff\/admin/i);
  });
});
