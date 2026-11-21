// Real PostgreSQL integration test for F02 delivery claims.
//
// Runs only when ARTEMIS_TEST_DATABASE_URL points at a disposable, migrated
// database (`npx prisma migrate deploy` against it first). It writes and
// deletes its own rows, scoped by a random guild ID. Skipped otherwise.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "@artemis/db";
import { MessageJobsService } from "./message-jobs.service.js";

const url = process.env.ARTEMIS_TEST_DATABASE_URL;

describe.skipIf(!url)("MessageJobsService claims against PostgreSQL", () => {
  let client: PrismaClient;
  let service: MessageJobsService;
  const guildId = `it-${randomUUID()}`;
  let eventId: string;

  beforeAll(async () => {
    client = createPrismaClient({ connectionString: url, max: 10 });
    service = new MessageJobsService({ client } as never);
    const eventType = await client.eventType.create({
      data: { guildId, key: "it", name: "Integration" },
    });
    const event = await client.event.create({
      data: {
        guildId,
        eventTypeId: eventType.id,
        title: "Integration event",
        gameSystem: "D&D",
        channelId: "chan",
        startAt: new Date(Date.now() + 3_600_000),
        endAt: new Date(Date.now() + 7_200_000),
        createdByDiscordId: "creator",
      },
    });
    eventId = event.id;
  });

  afterAll(async () => {
    if (!client) return;
    await client.event.deleteMany({ where: { guildId } });
    await client.eventType.deleteMany({ where: { guildId } });
    await client.$disconnect();
  });

  async function seed(count: number) {
    await client.eventMessageJob.deleteMany({ where: { eventId } });
    await client.eventMessageJob.createMany({
      data: Array.from({ length: count }, (_, i) => ({
        deliveryKey: `${eventId}:IT:${i}`,
        eventId,
        messageType: "ASSIGNMENT_SEATED" as const,
        targetType: "USER" as const,
        targetId: `user-${i}`,
        scheduledFor: new Date(Date.now() - 1000),
      })),
    });
  }

  it("never lets two concurrent workers claim the same row", async () => {
    await seed(40);
    const owners = Array.from({ length: 6 }, (_, i) => `worker-${i}`);
    const batches = await Promise.all(owners.map((o) => service.claimDueJobs(o, 10)));
    const ids = batches.flat().map((j) => j.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(40);
  });

  it("reclaims a job whose lease expired, but not one still leased", async () => {
    await seed(1);
    const [first] = await service.claimDueJobs("crashed", 10, 60_000);
    expect(first).toBeDefined();
    expect(await service.claimDueJobs("other", 10)).toHaveLength(0);

    await client.eventMessageJob.update({
      where: { id: first.id },
      data: { leaseExpiresAt: new Date(Date.now() - 1000) },
    });
    const [again] = await service.claimDueJobs("recovering", 10);
    expect(again.id).toBe(first.id);
    expect(again.attempts).toBe(2);

    // The crashed worker's late success must not overwrite the new owner.
    await service.markSent(first.id, "crashed");
    const row = await client.eventMessageJob.findUniqueOrThrow({ where: { id: first.id } });
    expect(row.status).toBe("PROCESSING");
    expect(row.leaseOwner).toBe("recovering");
  });

  it("does not claim a job that is backing off", async () => {
    await seed(1);
    const [job] = await service.claimDueJobs("w", 10);
    await service.markFailed(job.id, new Error("fetch failed"), {
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      leaseOwner: "w",
    });
    expect(await service.claimDueJobs("w2", 10)).toHaveLength(0);
  });
});

describe.skipIf(!url)("Series occurrence uniqueness against PostgreSQL (F03)", () => {
  let client: PrismaClient;
  const guildId = `it-${randomUUID()}`;

  beforeAll(() => {
    client = createPrismaClient({ connectionString: url, max: 5 });
  });

  afterAll(async () => {
    if (!client) return;
    await client.event.deleteMany({ where: { guildId } });
    await client.eventSeries.deleteMany({ where: { guildId } });
    await client.eventType.deleteMany({ where: { guildId } });
    await client.$disconnect();
  });

  it("allows only one event per series slot, even under concurrent inserts", async () => {
    const eventType = await client.eventType.create({ data: { guildId, key: "it-series", name: "IT" } });
    const series = await client.eventSeries.create({
      data: {
        guildId, eventTypeId: eventType.id, name: "IT series", defaultChannelId: "chan",
        recurrenceRule: "WEEKLY:FRI", createdByDiscordId: "creator",
      },
    });
    const insert = () =>
      client.event.create({
        data: {
          guildId, eventTypeId: eventType.id, seriesId: series.id, occurrenceKey: "2030-01-04",
          title: "Slot", gameSystem: "D&D", channelId: "chan",
          startAt: new Date("2030-01-04T23:00:00Z"), endAt: new Date("2030-01-05T03:00:00Z"),
          createdByDiscordId: "creator",
        },
      });
    const results = await Promise.allSettled([insert(), insert(), insert()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results) {
      if (r.status === "rejected") expect((r.reason as { code?: string }).code).toBe("P2002");
    }
  });
});
