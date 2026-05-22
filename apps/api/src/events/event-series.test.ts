import { describe, expect, it, vi, beforeEach } from "vitest";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { eventSeriesCreateSchema, makeDateInTimezone, WEEKDAY_TO_JS } from "@artemis/domain";

// ─── Schema validation (no Prisma needed) ────────────────────────────────────

describe("eventSeriesCreateSchema", () => {
  const base = {
    guildId: "123",
    name: "Friday Night D&D",
    defaultChannelId: "456",
    recurrenceRule: "WEEKLY:FRI",
    createdByDiscordId: "789",
  };

  it("accepts a valid weekly series with defaults", () => {
    const result = eventSeriesCreateSchema.parse(base);
    expect(result.recurrenceRule).toBe("WEEKLY:FRI");
    expect(result.defaultStartHour).toBe(18);
    expect(result.defaultDurationMinutes).toBe(240);
    expect(result.defaultGameSystem).toBe("D&D");
  });

  it("rejects monthly recurrence", () => {
    expect(() => eventSeriesCreateSchema.parse({ ...base, recurrenceRule: "MONTHLY:1" })).toThrow();
  });

  it("rejects full weekday names", () => {
    expect(() => eventSeriesCreateSchema.parse({ ...base, recurrenceRule: "WEEKLY:FRIDAY" })).toThrow();
  });

  it("accepts custom start time and duration", () => {
    const result = eventSeriesCreateSchema.parse({
      ...base,
      defaultStartHour: 19,
      defaultStartMinute: 30,
      defaultDurationMinutes: 180,
    });
    expect(result.defaultStartHour).toBe(19);
    expect(result.defaultStartMinute).toBe(30);
    expect(result.defaultDurationMinutes).toBe(180);
  });
});

// ─── Timezone-safe date generation (pure logic) ───────────────────────────────

describe("occurrence date construction", () => {
  it("builds 6pm EDT correctly for a Friday in June (UTC-4)", () => {
    // June 5 2026 18:00 EDT = 22:00 UTC
    const date = makeDateInTimezone(2026, 6, 5, 18, 0, "America/New_York");
    expect(date.getUTCHours()).toBe(22);
    expect(date.getUTCMonth()).toBe(5); // 0-based June
    expect(date.getUTCDate()).toBe(5);
  });

  it("builds 6pm EST correctly for a Friday in January (UTC-5)", () => {
    // Jan 9 2026 18:00 EST = 23:00 UTC
    const date = makeDateInTimezone(2026, 1, 9, 18, 0, "America/New_York");
    expect(date.getUTCHours()).toBe(23);
    expect(date.getUTCDate()).toBe(9);
  });

  it("targets the correct calendar day from the guild timezone", () => {
    // WEEKDAY_TO_JS.FRI = 5
    const friday = WEEKDAY_TO_JS.FRI!;
    // Verify the constant maps correctly
    expect(friday).toBe(5);
  });
});

// ─── EventSeriesService with mocked Prisma ───────────────────────────────────

// Build a minimal mock factory for Prisma and the EventsService dependency.
function makePrismaMock(overrides: Record<string, unknown> = {}) {
  return {
    client: {
      eventSeries: {
        findUnique: vi.fn(),
        create: vi.fn(),
        findMany: vi.fn(),
      },
      guildSettings: {
        findUnique: vi.fn().mockResolvedValue({ defaultTimezone: "America/New_York" }),
      },
      eventType: {
        findFirst: vi.fn(),
      },
      ...overrides,
    },
  };
}

describe("EventSeriesService.generate integration (mocked)", () => {
  it("rejects generation for a non-existent series", async () => {
    const { EventSeriesService } = await import("./event-series.service.js");
    const prisma = makePrismaMock();
    (prisma.client.eventSeries.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const svc = new EventSeriesService(prisma as any, {} as any);
    await expect(svc.generate("nonexistent", {})).rejects.toThrow(NotFoundException);
  });

  it("rejects generation when recurrenceRule is malformed", async () => {
    const { EventSeriesService } = await import("./event-series.service.js");
    const prisma = makePrismaMock();
    (prisma.client.eventSeries.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "s1",
      guildId: "g1",
      recurrenceRule: "DAILY", // invalid
      events: [],
      defaultStartHour: 18,
      defaultStartMinute: 0,
      defaultDurationMinutes: 240,
      defaultChannelId: "ch1",
      defaultGameSystem: "D&D",
      defaultTitle: "",
      defaultDescription: null,
      defaultImageUrl: null,
      name: "test",
      createdByDiscordId: "u1",
    });

    const svc = new EventSeriesService(prisma as any, {} as any);
    await expect(svc.generate("s1", {})).rejects.toThrow(BadRequestException);
  });

  it("creates events at 6pm in the guild timezone for a weekly Friday series", async () => {
    const { EventSeriesService } = await import("./event-series.service.js");

    const createdEvents: { startAt: string }[] = [];
    const eventsCreate = vi.fn().mockImplementation((args: { data: { startAt: string } }) => {
      createdEvents.push({ startAt: args.data.startAt });
      return { id: "ev1", startAt: new Date(args.data.startAt), title: "t" };
    });

    const prisma = makePrismaMock();
    // Override guildSettings to return a specific TZ
    (prisma.client.guildSettings.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      defaultTimezone: "America/New_York",
    });
    (prisma.client.eventSeries.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "s1",
      guildId: "g1",
      recurrenceRule: "WEEKLY:FRI",
      events: [], // no prior events; start from today
      defaultStartHour: 18,
      defaultStartMinute: 0,
      defaultDurationMinutes: 240,
      defaultChannelId: "ch1",
      defaultGameSystem: "D&D",
      defaultTitle: "Test",
      defaultDescription: null,
      defaultImageUrl: null,
      name: "Test",
      createdByDiscordId: "u1",
    });

    const eventsService = {
      create: vi.fn().mockImplementation((args: { startAt: string }) => {
        createdEvents.push({ startAt: args.startAt });
        return { id: "ev1", startAt: new Date(args.startAt) };
      }),
    };

    const svc = new EventSeriesService(prisma as any, eventsService as any);
    const result = await svc.generate("s1", { count: 1 });

    expect(result.created).toBe(1);
    // The created event should be on a Friday at 6pm Eastern
    const startAt = new Date(createdEvents[0]!.startAt);
    const dayInEastern = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", weekday: "short",
    }).format(startAt);
    expect(dayInEastern).toBe("Fri");

    const hourInEastern = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", hour: "numeric", hourCycle: "h23",
    }).format(startAt);
    expect(hourInEastern).toBe("18");
  });
});
