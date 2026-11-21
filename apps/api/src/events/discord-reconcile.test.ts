import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictException } from "@nestjs/common";
import { DiscordRoleService } from "./discord-role.service.js";
import { DiscordEventPostService } from "./discord-event-post.service.js";

const metrics = { discordFailures: { inc: vi.fn() } };

type FetchCall = { url: string; method: string };

function mockDiscord(responder: (call: FetchCall) => { status: number; body?: string }) {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { method: string }) => {
      const call = { url, method: init.method };
      calls.push(call);
      const { status, body = "" } = responder(call);
      return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => body,
      };
    }),
  );
  return calls;
}

function membershipPrisma(row: Record<string, unknown>, role: Record<string, unknown> | null) {
  const updates: Array<Record<string, unknown>> = [];
  const prisma = {
    client: {
      eventDiscordMembership: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(row),
        update: vi.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
          updates.push(args.data);
          return Promise.resolve({});
        }),
      },
      eventRole: { findUnique: vi.fn().mockResolvedValue(role) },
    },
  };
  return { prisma, updates };
}

const baseRow = {
  id: "m1",
  eventId: "e1",
  discordUserId: "u1",
  desired: true,
  attempts: 0,
  event: { guildId: "g1", discordThreadId: "t1" },
};

describe("DiscordRoleService.reconcileMembership (F04)", () => {
  beforeEach(() => {
    process.env.DISCORD_TOKEN = "test-token";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.DISCORD_TOKEN;
  });

  it("grants the role and thread access and marks the row synced", async () => {
    const calls = mockDiscord(() => ({ status: 204 }));
    const { prisma, updates } = membershipPrisma(baseRow, { discordRoleId: "r1", deletedAt: null });
    const svc = new DiscordRoleService(prisma as never, metrics as never);

    await expect(svc.reconcileMembership("m1")).resolves.toBe("SYNCED");
    expect(calls.map((c) => `${c.method} ${c.url.replace("https://discord.com/api/v10", "")}`)).toEqual([
      "PUT /guilds/g1/members/u1/roles/r1",
      "PUT /channels/t1/thread-members/u1",
    ]);
    expect(updates[0]).toMatchObject({ status: "SYNCED", roleApplied: true, threadApplied: true });
  });

  it("treats an already-removed member as success when revoking", async () => {
    mockDiscord(() => ({ status: 404, body: '{"code":10007}' }));
    const { prisma, updates } = membershipPrisma({ ...baseRow, desired: false }, { discordRoleId: "r1", deletedAt: null });
    const svc = new DiscordRoleService(prisma as never, metrics as never);

    await expect(svc.reconcileMembership("m1")).resolves.toBe("SYNCED");
    expect(updates[0]).toMatchObject({ status: "SYNCED", roleApplied: false, threadApplied: false });
  });

  it("records a permission error as FAILED instead of reporting success", async () => {
    mockDiscord(() => ({ status: 403, body: '{"message":"Missing Permissions","code":50013}' }));
    const { prisma, updates } = membershipPrisma(baseRow, { discordRoleId: "r1", deletedAt: null });
    const svc = new DiscordRoleService(prisma as never, metrics as never);

    await expect(svc.reconcileMembership("m1")).resolves.toBe("FAILED");
    expect(updates[0]).toMatchObject({ status: "FAILED", attempts: 1 });
    expect(String(updates[0].lastError)).toContain("403");
  });

  it("retries transient errors later", async () => {
    mockDiscord(() => ({ status: 502, body: "bad gateway" }));
    const { prisma, updates } = membershipPrisma(baseRow, { discordRoleId: "r1", deletedAt: null });
    const svc = new DiscordRoleService(prisma as never, metrics as never);

    await expect(svc.reconcileMembership("m1")).resolves.toBe("PENDING");
    expect(updates[0].nextAttemptAt).toBeInstanceOf(Date);
  });

  it("does nothing when another reconciler already claimed the row", async () => {
    const calls = mockDiscord(() => ({ status: 204 }));
    const { prisma } = membershipPrisma(baseRow, null);
    prisma.client.eventDiscordMembership.updateMany.mockResolvedValue({ count: 0 });
    const svc = new DiscordRoleService(prisma as never, metrics as never);

    await expect(svc.reconcileMembership("m1")).resolves.toBe("SKIPPED");
    expect(calls).toHaveLength(0);
  });
});

describe("DiscordRoleService.computeDesiredAccess (F04)", () => {
  function prismaFor(rsvpStatus: string | null, hostsTable: boolean) {
    return {
      client: {
        rSVP: { findUnique: vi.fn().mockResolvedValue(rsvpStatus ? { status: rsvpStatus } : null) },
        eventTable: { findFirst: vi.fn().mockResolvedValue(hostsTable ? { id: "tbl" } : null) },
      },
    };
  }

  it("keeps access for a cancelled player who still hosts a table", async () => {
    const svc = new DiscordRoleService(prismaFor("CANCELLED", true) as never, metrics as never);
    await expect(svc.computeDesiredAccess("e1", "u1")).resolves.toBe(true);
  });

  it("removes access after cancelling with no other reason", async () => {
    const svc = new DiscordRoleService(prismaFor("CANCELLED", false) as never, metrics as never);
    await expect(svc.computeDesiredAccess("e1", "u1")).resolves.toBe(false);
  });

  it("grants access to waitlisted players", async () => {
    const svc = new DiscordRoleService(prismaFor("WAITLISTED", false) as never, metrics as never);
    await expect(svc.computeDesiredAccess("e1", "u1")).resolves.toBe(true);
  });
});

describe("DiscordRoleService.processExpiredRoles (F04)", () => {
  beforeEach(() => {
    process.env.DISCORD_TOKEN = "test-token";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.DISCORD_TOKEN;
  });

  function rolePrisma() {
    const updates: Array<Record<string, unknown>> = [];
    const prisma = {
      client: {
        eventRole: {
          findMany: vi.fn().mockResolvedValue([
            { id: "role-row", discordRoleId: "r1", cleanupAttempts: 0, event: { guildId: "g1" } },
          ]),
          update: vi.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
            updates.push(args.data);
            return Promise.resolve({});
          }),
        },
      },
    };
    return { prisma, updates };
  }

  it("does not mark a role deleted when Discord refuses the delete", async () => {
    mockDiscord(() => ({ status: 403, body: '{"code":50013}' }));
    const { prisma, updates } = rolePrisma();
    await new DiscordRoleService(prisma as never, metrics as never).processExpiredRoles();
    expect(updates[0].deletedAt).toBeUndefined();
    expect(updates[0]).toMatchObject({ cleanupAttempts: 1 });
    expect(updates[0].cleanupNextAttemptAt).toBeInstanceOf(Date);
  });

  it("marks a role deleted when Discord confirms or it is already gone", async () => {
    mockDiscord(() => ({ status: 404, body: '{"code":10011}' }));
    const { prisma, updates } = rolePrisma();
    await new DiscordRoleService(prisma as never, metrics as never).processExpiredRoles();
    expect(updates[0].deletedAt).toBeInstanceOf(Date);
  });
});

describe("DiscordEventPostService publish lease (F04)", () => {
  afterEach(() => {
    delete process.env.DISCORD_TOKEN;
  });

  it("rejects a publish while another publish holds the lease", async () => {
    process.env.DISCORD_TOKEN = "test-token";
    const prisma = {
      client: {
        event: {
          findUnique: vi.fn().mockResolvedValue({ id: "e1", tables: [], participants: [], eventType: null }),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      },
    };
    const svc = new DiscordEventPostService(prisma as never, metrics as never);
    await expect(svc.publishEventPost("e1", "actor")).rejects.toThrow(ConflictException);
  });
});
