import { describe, expect, it, vi } from "vitest";
import { BadRequestException, ExecutionContext, ForbiddenException, NotFoundException } from "@nestjs/common";
import {
  AmbassadorGuildScopeGuard,
  EventGuildScopeGuard,
  GuildScopeGuard,
  PathGuildIdScopeGuard,
} from "./guild-scope.guard.js";

function makeReflector(overrides: { isPublic?: boolean; isDirectory?: boolean } = {}) {
  return {
    getAllAndOverride: vi.fn((key: string) => {
      if (key === "isPublicRoute") return overrides.isPublic ?? false;
      if (key === "isGuildDirectoryRoute") return overrides.isDirectory ?? false;
      return false;
    }),
  } as unknown as import("@nestjs/core").Reflector;
}

function makeContext(request: {
  headers?: Record<string, string>;
  params?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: unknown;
}): ExecutionContext {
  return {
    getHandler: () => ({}) as never,
    getClass: () => ({}) as never,
    switchToHttp: () => ({
      getRequest: () => ({
        headers: request.headers ?? {},
        params: request.params ?? {},
        query: request.query ?? {},
        body: request.body,
      }),
    }),
  } as unknown as ExecutionContext;
}

describe("GuildScopeGuard", () => {
  it("rejects requests missing the guild header", () => {
    const guard = new GuildScopeGuard(makeReflector());
    expect(() => guard.canActivate(makeContext({}))).toThrow(BadRequestException);
  });

  it("allows a request whose query guildId matches the header", () => {
    const guard = new GuildScopeGuard(makeReflector());
    const ctx = makeContext({ headers: { "x-artemis-guild-id": "g1" }, query: { guildId: "g1" } });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it("rejects a request whose query guildId does not match the header", () => {
    const guard = new GuildScopeGuard(makeReflector());
    const ctx = makeContext({ headers: { "x-artemis-guild-id": "g1" }, query: { guildId: "g2" } });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it("rejects a request whose body guildId does not match the header", () => {
    const guard = new GuildScopeGuard(makeReflector());
    const ctx = makeContext({ headers: { "x-artemis-guild-id": "g1" }, body: { guildId: "g2" } });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it("skips the check on public routes", () => {
    const guard = new GuildScopeGuard(makeReflector({ isPublic: true }));
    expect(guard.canActivate(makeContext({}))).toBe(true);
  });

  it("skips the check on guild-directory routes", () => {
    const guard = new GuildScopeGuard(makeReflector({ isDirectory: true }));
    expect(guard.canActivate(makeContext({}))).toBe(true);
  });
});

describe("EventGuildScopeGuard", () => {
  function makeGuard(event: { guildId: string } | null) {
    const prisma = { client: { event: { findUnique: vi.fn().mockResolvedValue(event) } } };
    return new EventGuildScopeGuard(makeReflector(), prisma as never);
  }

  it("allows access when the event's guild matches the header", async () => {
    const guard = makeGuard({ guildId: "g1" });
    const ctx = makeContext({ headers: { "x-artemis-guild-id": "g1" }, params: { id: "ev1" } });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it("rejects access when the event belongs to a different guild", async () => {
    const guard = makeGuard({ guildId: "g2" });
    const ctx = makeContext({ headers: { "x-artemis-guild-id": "g1" }, params: { id: "ev1" } });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it("404s when the event does not exist", async () => {
    const guard = makeGuard(null);
    const ctx = makeContext({ headers: { "x-artemis-guild-id": "g1" }, params: { id: "missing" } });
    await expect(guard.canActivate(ctx)).rejects.toThrow(NotFoundException);
  });

  it("falls back to the base query/body check when there's no :id param (list/create routes)", async () => {
    const guard = makeGuard(null);
    const ctx = makeContext({ headers: { "x-artemis-guild-id": "g1" }, query: { guildId: "g1" } });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});

describe("AmbassadorGuildScopeGuard", () => {
  it("rejects cross-guild access to another guild's ambassador profile", async () => {
    const prisma = { client: { ambassadorProfile: { findUnique: vi.fn().mockResolvedValue({ guildId: "g2" }) } } };
    const guard = new AmbassadorGuildScopeGuard(makeReflector(), prisma as never);
    const ctx = makeContext({ headers: { "x-artemis-guild-id": "g1" }, params: { id: "amb1" } });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });
});

describe("PathGuildIdScopeGuard", () => {
  it("allows a matching :guildId path param", () => {
    const guard = new PathGuildIdScopeGuard(makeReflector());
    const ctx = makeContext({ headers: { "x-artemis-guild-id": "g1" }, params: { guildId: "g1" } });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it("rejects a mismatched :guildId path param", () => {
    const guard = new PathGuildIdScopeGuard(makeReflector());
    const ctx = makeContext({ headers: { "x-artemis-guild-id": "g1" }, params: { guildId: "g2" } });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
