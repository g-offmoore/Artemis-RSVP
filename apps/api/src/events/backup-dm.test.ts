import { describe, expect, it, vi } from "vitest";
import { BadRequestException, NotFoundException } from "@nestjs/common";

// ─── EventsService.handleBackupDmAction ──────────────────────────────────────
// Tests the accept/decline/release state-machine logic.
// Prisma and Discord dependencies are fully mocked so no DB or network is needed.

function makeDeps() {
  const updatedParticipants: Array<{ id: string; backupDmStatus: string }> = [];

  const prisma = {
    client: {
      event: {
        findUnique: vi.fn().mockResolvedValue({
          id: "ev1",
          guildId: "g1",
          title: "Test Event",
          createdByDiscordId: "org1",
        }),
      },
      eventParticipant: {
        findUnique: vi.fn().mockResolvedValue({
          id: "p1",
          eventId: "ev1",
          signupRole: "BACKUP_DM",
          discordUserId: "u1",
          backupDmStatus: "BACKUP_AVAILABLE_AS_PLAYER",
          assignments: [],
        }),
        update: vi.fn().mockImplementation(({ where, data }: { where: { id: string }; data: { backupDmStatus: string } }) => {
          updatedParticipants.push({ id: where.id, backupDmStatus: data.backupDmStatus });
          return { id: where.id, ...data };
        }),
      },
      ambassadorProfile: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      assignment: { update: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn().mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn({
        event: { findUnique: vi.fn() },
        eventParticipant: {
          findUnique: vi.fn().mockResolvedValue({
            id: "p1",
            eventId: "ev1",
            signupRole: "BACKUP_DM",
            discordUserId: "u1",
            backupDmStatus: "BACKUP_AVAILABLE_AS_PLAYER",
            assignments: [],
          }),
          update: vi.fn().mockImplementation(({ where, data }: { where: { id: string }; data: { backupDmStatus: string } }) => {
            updatedParticipants.push({ id: where.id, backupDmStatus: data.backupDmStatus });
            return { id: where.id, ...data };
          }),
        },
        assignment: { update: vi.fn().mockResolvedValue({}) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
        ambassadorProfile: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      })),
    },
  };

  return { prisma, updatedParticipants };
}

describe("EventsService backup DM state transitions", () => {
  it("decline action sets status to BACKUP_DECLINED_PULL", async () => {
    const { EventsService } = await import("./events.service.js");
    const { prisma, updatedParticipants } = makeDeps();

    const svc = new EventsService(
      prisma as any,
      { inc: vi.fn() } as any, // MetricsService stub (assignmentFailures)
      { sendOpsAlert: vi.fn() } as any,
      { scheduleEventMessages: vi.fn(), rescheduleEventMessages: vi.fn() } as any,
      { ensureEventRole: vi.fn().mockResolvedValue({ ok: true, discordRoleId: "r1" }),
        ensureEventThread: vi.fn().mockResolvedValue({ ok: true, discordThreadId: "t1" }),
        assignRoleToMember: vi.fn(),
        addMemberToThread: vi.fn(),
        postToThread: vi.fn(),
      } as any,
    );

    const result = await svc.handleBackupDmAction("ev1", {
      actorDiscordId: "actor1",
      participantId: "p1",
      action: "decline",
    });

    expect(result.backupDmStatus).toBe("BACKUP_DECLINED_PULL");
    expect(updatedParticipants.some((p) => p.backupDmStatus === "BACKUP_DECLINED_PULL")).toBe(true);
  });

  it("release action sets status to BACKUP_RELEASED_AS_PLAYER", async () => {
    const { EventsService } = await import("./events.service.js");
    const { prisma, updatedParticipants } = makeDeps();

    const svc = new EventsService(
      prisma as any,
      { inc: vi.fn() } as any,
      { sendOpsAlert: vi.fn() } as any,
      { scheduleEventMessages: vi.fn(), rescheduleEventMessages: vi.fn() } as any,
      { ensureEventRole: vi.fn().mockResolvedValue({ ok: true, discordRoleId: "r1" }),
        ensureEventThread: vi.fn().mockResolvedValue({ ok: true, discordThreadId: "t1" }),
        assignRoleToMember: vi.fn(),
        addMemberToThread: vi.fn(),
        postToThread: vi.fn(),
      } as any,
    );

    const result = await svc.handleBackupDmAction("ev1", {
      actorDiscordId: "actor1",
      participantId: "p1",
      action: "release",
    });

    expect(result.backupDmStatus).toBe("BACKUP_RELEASED_AS_PLAYER");
  });

  it("rejects action for non-BACKUP_DM participant", async () => {
    const { EventsService } = await import("./events.service.js");
    const { prisma } = makeDeps();

    // Override to return a non-BACKUP_DM participant
    (prisma.client.eventParticipant.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "p1",
      eventId: "ev1",
      signupRole: "PLAYER",
      assignments: [],
    });
    prisma.client.$transaction = vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        eventParticipant: {
          findUnique: vi.fn().mockResolvedValue({ id: "p1", eventId: "ev1", signupRole: "PLAYER", assignments: [] }),
          update: vi.fn(),
        },
        auditLog: { create: vi.fn() },
        assignment: { update: vi.fn() },
        ambassadorProfile: { updateMany: vi.fn() },
      }),
    );

    const svc = new EventsService(
      prisma as any,
      { inc: vi.fn() } as any,
      { sendOpsAlert: vi.fn() } as any,
      { scheduleEventMessages: vi.fn(), rescheduleEventMessages: vi.fn() } as any,
      { ensureEventRole: vi.fn(), ensureEventThread: vi.fn(), assignRoleToMember: vi.fn(),
        addMemberToThread: vi.fn(), postToThread: vi.fn() } as any,
    );

    await expect(
      svc.handleBackupDmAction("ev1", {
        actorDiscordId: "actor1",
        participantId: "p1",
        action: "decline",
      }),
    ).rejects.toThrow(BadRequestException);
  });
});

// ─── Guest limit enforcement ──────────────────────────────────────────────────

describe("EventsService guest limit", () => {
  it("rejects guest list exceeding maxGuestsPerRsvp", async () => {
    const { EventsService } = await import("./events.service.js");

    const prisma = {
      client: {
        event: {
          findUnique: vi.fn().mockResolvedValue({
            id: "ev1",
            guildId: "g1",
            eventType: { maxGuestsPerRsvp: 3 },
          }),
        },
      },
    };

    const svc = new EventsService(
      prisma as any,
      { inc: vi.fn() } as any,
      { sendOpsAlert: vi.fn() } as any,
      {} as any,
      {} as any,
    );

    await expect(
      svc.updateGuests("ev1", "u1", {
        guests: [
          { displayName: "Alice" },
          { displayName: "Bob" },
          { displayName: "Carol" },
          { displayName: "Dave" }, // over limit of 3
        ],
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
