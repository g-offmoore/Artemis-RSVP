import { describe, expect, it, vi } from "vitest";
import { EventsService } from "./events.service.js";

const input = {
  guildId: "guild",
  channelId: "channel",
  title: "Event",
  createdByDiscordId: "organizer",
  startAt: new Date("2027-08-01T18:00:00Z"),
  endAt: new Date("2027-08-01T22:00:00Z"),
};

function setup(offset = 120) {
  let stored = {
    ...input,
    id: "event",
    seriesId: null,
    assignmentLockOffsetMinutes: offset,
  };
  const event = {
    findUnique: vi.fn(async () => stored),
    create: vi.fn(async ({ data }) => {
      stored = { ...stored, ...data };
      return stored;
    }),
    update: vi.fn(async ({ data }) => {
      stored = { ...stored, ...data };
      return stored;
    }),
  };
  const tx = {
    event,
    eventType: { create: vi.fn(async () => ({ id: "type" })) },
  };
  const prisma = {
    client: { ...tx, $transaction: vi.fn(async (fn) => fn(tx)) },
  };
  const jobs = {
    scheduleEventMessages: vi.fn(),
    rescheduleEventMessages: vi.fn(),
  };
  const discord = {
    ensureEventRole: vi.fn(async () => ({ ok: true })),
    ensureEventThread: vi.fn(async () => ({ ok: true })),
  };
  return {
    event,
    jobs,
    service: new EventsService(
      prisma as never,
      {} as never,
      {} as never,
      jobs as never,
      discord as never,
    ),
  };
}

describe("EventsService assignment lock policy wiring (mock persistence)", () => {
  it.each([undefined, 0, 30, 120])(
    "persists and schedules creation offset %s",
    async (offset) => {
      const { service, event, jobs } = setup();
      await service.create({
        ...input,
        ...(offset === undefined
          ? {}
          : { assignmentLockOffsetMinutes: offset }),
      });
      const expected = offset === undefined ? 60 : offset;
      expect(
        event.create.mock.calls[0][0].data.assignmentLockOffsetMinutes,
      ).toBe(expected);
      expect(
        jobs.scheduleEventMessages.mock.calls[0][0].assignmentLockOffsetMinutes,
      ).toBe(expected);
    },
  );

  it("preserves legacy policy on a time edit and passes it to rescheduling", async () => {
    const { service, event, jobs } = setup();
    await service.update("event", {
      actorDiscordId: "organizer",
      startAt: "2027-08-02T18:00:00Z",
      endAt: "2027-08-02T22:00:00Z",
    });
    expect(event.update.mock.calls[0][0].data).not.toHaveProperty(
      "assignmentLockOffsetMinutes",
    );
    expect(
      jobs.rescheduleEventMessages.mock.calls[0][0].assignmentLockOffsetMinutes,
    ).toBe(120);
  });

  it("reschedules an offset-only edit, including explicit zero", async () => {
    const { service, event, jobs } = setup();
    await service.update("event", {
      actorDiscordId: "organizer",
      assignmentLockOffsetMinutes: 0,
    });
    expect(event.update.mock.calls[0][0].data.assignmentLockOffsetMinutes).toBe(
      0,
    );
    expect(
      jobs.rescheduleEventMessages.mock.calls[0][0].assignmentLockOffsetMinutes,
    ).toBe(0);
  });

  it("rejects invalid offsets before persistence", async () => {
    const { service, event } = setup();
    await expect(
      service.create({ ...input, assignmentLockOffsetMinutes: -1 }),
    ).rejects.toThrow();
    await expect(
      service.update("event", {
        actorDiscordId: "organizer",
        assignmentLockOffsetMinutes: null,
      }),
    ).rejects.toThrow();
    expect(event.create).not.toHaveBeenCalled();
    expect(event.update).not.toHaveBeenCalled();
  });
});
