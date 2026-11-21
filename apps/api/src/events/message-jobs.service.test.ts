import { describe, expect, it, vi } from "vitest";
import { MessageJobsService, SkipDeliveryError } from "./message-jobs.service.js";

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
  shortageAlertHoursBefore: null,
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

describe("MessageJobsService.processDueJobs (F02)", () => {
  function makeService(claimed: Array<Record<string, unknown>>) {
    const updates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
    const prisma = {
      client: {
        $queryRaw: vi.fn().mockResolvedValue(claimed),
        eventMessageJob: {
          updateMany: vi.fn().mockImplementation((args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
            updates.push(args);
            return Promise.resolve({ count: 1 });
          }),
        },
      },
    };
    return { service: new MessageJobsService(prisma as never), updates };
  }

  const job = (id: string, attempts = 1) => ({
    id, eventId: "evt-1", messageType: "ASSIGNMENT_SEATED", targetId: "u1",
    deliveryKey: `evt-1:ASSIGNMENT:1:${id}`, attempts, maxAttempts: 5,
  });

  it("marks sent under the worker's lease and stores the remote message id", async () => {
    const { service, updates } = makeService([job("j1")]);
    const res = await service.processDueJobs(async () => ({ remoteMessageId: "m1" }), "lease-a");
    expect(res).toMatchObject({ processed: 1, failed: 0, retried: 0, skipped: 0 });
    expect(updates[0].where).toEqual({ id: "j1", leaseOwner: "lease-a" });
    expect(updates[0].data).toMatchObject({ status: "SENT", remoteMessageId: "m1", leaseOwner: null });
  });

  it("re-queues retryable failures with a backoff instead of failing them", async () => {
    const { service, updates } = makeService([job("j1")]);
    const res = await service.processDueJobs(async () => { throw new Error("fetch failed"); }, "lease-a");
    expect(res.retried).toBe(1);
    expect(updates[0].data.status).toBe("PENDING");
    expect(updates[0].data.nextAttemptAt).toBeInstanceOf(Date);
  });

  it("fails terminal errors without retrying", async () => {
    const { service, updates } = makeService([job("j1")]);
    const res = await service.processDueJobs(async () => {
      throw new Error('Discord API 403 (/x): {"code":50007}');
    }, "lease-a");
    expect(res.failed).toBe(1);
    expect(updates[0].data.status).toBe("FAILED");
  });

  it("fails after the final attempt", async () => {
    const { service, updates } = makeService([job("j1", 5)]);
    await service.processDueJobs(async () => { throw new Error("fetch failed"); }, "lease-a");
    expect(updates[0].data.status).toBe("FAILED");
  });

  it("skips deliveries the dispatcher rejects as stale", async () => {
    const { service, updates } = makeService([job("j1")]);
    const res = await service.processDueJobs(async () => {
      throw new SkipDeliveryError("Event was cancelled");
    }, "lease-a");
    expect(res.skipped).toBe(1);
    expect(updates[0].data).toMatchObject({ status: "SKIPPED", lastError: "Event was cancelled" });
  });
});
