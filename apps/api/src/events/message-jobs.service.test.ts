import { describe, expect, it, vi } from "vitest";
import { MessageJobsService } from "./message-jobs.service.js";

function makePrismaStub() {
  const upsertCalls: Array<{ create: Record<string, unknown> }> = [];
  const prisma = {
    client: {
      eventMessageJob: {
        upsert: vi.fn().mockImplementation((args: { create: Record<string, unknown> }) => {
          upsertCalls.push(args);
          return Promise.resolve(args.create);
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: vi.fn().mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops)),
    },
  };
  return { prisma, upsertCalls };
}

const event = {
  id: "evt-1",
  channelId: "chan-1",
  startAt: new Date("2026-08-01T18:00:00Z"),
  endAt: new Date("2026-08-01T22:00:00Z"),
  createdByDiscordId: "creator-1",
};

describe("MessageJobsService.scheduleEventMessages", () => {
  it("schedules all six job types, including the T-24h PREFLIGHT DM", async () => {
    const { prisma, upsertCalls } = makePrismaStub();
    const service = new MessageJobsService(prisma as never);

    await service.scheduleEventMessages(event);

    const byType = new Map(upsertCalls.map((c) => [c.create.messageType as string, c.create]));
    expect([...byType.keys()].sort()).toEqual(
      ["ASSIGNMENT_LOCK", "CUSTOM", "POST_EVENT", "PREFLIGHT", "PRE_EVENT", "REMINDER"].sort(),
    );

    const preflight = byType.get("PREFLIGHT")!;
    expect(preflight.targetType).toBe("USER");
    expect(preflight.targetId).toBe("creator-1");
    expect((preflight.scheduledFor as Date).toISOString()).toBe("2026-07-31T18:00:00.000Z");

    const reminder = byType.get("REMINDER")!;
    expect((reminder.scheduledFor as Date).getTime()).toBeGreaterThan(
      (preflight.scheduledFor as Date).getTime(),
    );
  });
});

describe("MessageJobsService.rescheduleEventMessages", () => {
  it("updates PENDING jobs for all six job types including PREFLIGHT", async () => {
    const { prisma } = makePrismaStub();
    const service = new MessageJobsService(prisma as never);

    await service.rescheduleEventMessages(event);

    const calledTypes = (prisma.client.eventMessageJob.updateMany as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => call[0].where.messageType,
    );
    expect(calledTypes.sort()).toEqual(
      ["ASSIGNMENT_LOCK", "CUSTOM", "POST_EVENT", "PREFLIGHT", "PRE_EVENT", "REMINDER"].sort(),
    );
  });
});
