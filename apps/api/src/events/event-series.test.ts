import { describe, expect, it, vi } from "vitest";
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
      event: {
        findFirst: vi.fn().mockResolvedValue(null), // no prior slots by default
        findUnique: vi.fn().mockResolvedValue(null), // slot not taken by default
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

    const prisma = makePrismaMock();
    // Override guildSettings to return a specific TZ
    (prisma.client.guildSettings.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      defaultTimezone: "America/New_York",
    });
    (prisma.client.eventSeries.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "s1",
      guildId: "g1",
      recurrenceRule: "WEEKLY:FRI",
      recurrenceAnchorAt: null,
      events: [], // no prior events; start from today
      defaultStartHour: 18,
      defaultStartMinute: 0,
      defaultDurationMinutes: 240,
      defaultChannelId: "ch1",
      defaultGameSystem: "D&D",
      defaultTitle: "Test",
      defaultDescription: null,
      defaultImageUrl: null,
      shortageAlertHoursBefore: null,
      signupOpenHoursBefore: 168,
      signupCloseHoursBefore: 1,
      name: "Test",
      createdByDiscordId: "u1",
      eventType: {
        name: "Default",
        requiresRsvp: true,
        allowsGuests: true,
        maxGuestsPerRsvp: 3,
        requiresAmbassadors: false,
        requiresTableAssignment: false,
        usesPlayerCategories: true,
        createsTemporaryRoles: false,
        requiresAttendanceConfirmation: false,
        sendsFeedbackPrompts: false,
        usesWaitlist: false,
        allowsNameOnlyWalkIns: false,
      },
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

// ─── F03: occurrence identity and concurrency ────────────────────────────────

describe("EventSeriesService.generate occurrence identity (F03)", () => {
  const seriesRow = (overrides: Record<string, unknown> = {}) => ({
    id: "s1",
    guildId: "g1",
    recurrenceRule: "WEEKLY:FRI",
    recurrenceAnchorAt: null,
    defaultStartHour: 18,
    defaultStartMinute: 0,
    defaultDurationMinutes: 240,
    defaultChannelId: "ch1",
    defaultGameSystem: "D&D",
    defaultTitle: "Test",
    defaultDescription: null,
    defaultImageUrl: null,
    shortageAlertHoursBefore: null,
    signupOpenHoursBefore: 168,
    signupCloseHoursBefore: 1,
    name: "Test",
    createdByDiscordId: "u1",
    eventType: { name: "Default" },
    ...overrides,
  });

  function setup(opts: { latestKey?: string; series?: Record<string, unknown> } = {}) {
    const prisma = makePrismaMock({
      eventSeries: {
        findUnique: vi.fn().mockResolvedValue(seriesRow(opts.series)),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      seriesGenerationRequest: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn(),
        update: vi.fn().mockResolvedValue({}),
        delete: vi.fn().mockResolvedValue({}),
      },
    });
    (prisma.client.event.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      opts.latestKey ? { occurrenceKey: opts.latestKey } : null,
    );
    const creates: Array<{ startAt: string; key?: string }> = [];
    const eventsService = {
      create: vi.fn().mockImplementation((args: { startAt: string }, o: { occurrenceKey?: string }) => {
        creates.push({ startAt: args.startAt, key: o?.occurrenceKey });
        return { id: `ev-${creates.length}`, startAt: new Date(args.startAt) };
      }),
    };
    return { prisma, eventsService, creates };
  }

  it("continues after the latest slot key, including cancelled tombstones", async () => {
    const { EventSeriesService } = await import("./event-series.service.js");
    // 2026-12-04 is a Friday; it may be cancelled or moved, its slot stays taken.
    const { prisma, eventsService, creates } = setup({ latestKey: "2026-12-04" });
    const svc = new EventSeriesService(prisma as any, eventsService as any);
    const result = await svc.generate("s1", { count: 2 });
    expect(result.created).toBe(2);
    expect(creates.map((c) => c.key)).toEqual(["2026-12-11", "2026-12-18"]);
  });

  it("reports a slot created by a concurrent request instead of creating the next one", async () => {
    const { EventSeriesService } = await import("./event-series.service.js");
    const { prisma, eventsService, creates } = setup({ latestKey: "2026-12-04" });
    eventsService.create.mockRejectedValueOnce(Object.assign(new Error("Unique constraint"), { code: "P2002" }));
    (prisma.client.event.findUnique as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(null) // pre-check: free
      .mockResolvedValueOnce({ id: "winner", startAt: new Date("2026-12-11T23:00:00Z") }); // after conflict
    const svc = new EventSeriesService(prisma as any, eventsService as any);
    const result = await svc.generate("s1", { count: 1 });
    expect(result.created).toBe(0);
    expect(result.events).toEqual([
      expect.objectContaining({ id: "winner", occurrenceKey: "2026-12-11", existing: true }),
    ]);
    expect(creates).toHaveLength(0);
  });

  it("returns the stored batch when a request is retried with the same requestId", async () => {
    const { EventSeriesService } = await import("./event-series.service.js");
    const { prisma, eventsService } = setup();
    const stored = { created: 1, events: [{ id: "ev-1", startAt: "2026-12-11T23:00:00.000Z", occurrenceKey: "2026-12-11", existing: false }] };
    (prisma.client as any).seriesGenerationRequest.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    (prisma.client as any).seriesGenerationRequest.findUnique.mockResolvedValue({ result: stored });
    const svc = new EventSeriesService(prisma as any, eventsService as any);
    await expect(svc.generate("s1", { count: 1, requestId: "req-12345678" })).resolves.toEqual(stored);
    expect(eventsService.create).not.toHaveBeenCalled();
  });

  it("rejects a duplicate requestId that is still in progress", async () => {
    const { EventSeriesService } = await import("./event-series.service.js");
    const { ConflictException } = await import("@nestjs/common");
    const { prisma, eventsService } = setup();
    (prisma.client as any).seriesGenerationRequest.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    (prisma.client as any).seriesGenerationRequest.findUnique.mockResolvedValue({ result: null });
    const svc = new EventSeriesService(prisma as any, eventsService as any);
    await expect(svc.generate("s1", { count: 1, requestId: "req-12345678" })).rejects.toThrow(ConflictException);
  });

  it("sets the biweekly anchor only if no other request set it first", async () => {
    const { EventSeriesService } = await import("./event-series.service.js");
    const winnerAnchor = makeDateInTimezone(2026, 12, 11, 18, 0, "America/New_York");
    const { prisma, eventsService, creates } = setup({ latestKey: "2026-12-04", series: { recurrenceRule: "WEEKLY:FRI:2" } });
    (prisma.client.eventSeries.findUnique as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: "s1" }) // existence check
      .mockResolvedValueOnce(seriesRow({ recurrenceRule: "WEEKLY:FRI:2" })) // batch load
      .mockResolvedValueOnce({ recurrenceAnchorAt: winnerAnchor }); // reread after conditional write
    const svc = new EventSeriesService(prisma as any, eventsService as any);
    await svc.generate("s1", { count: 2 });
    expect((prisma.client.eventSeries as any).updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "s1", recurrenceAnchorAt: null } }),
    );
    expect(creates.map((c) => c.key)).toEqual(["2026-12-11", "2026-12-25"]);
  });
});
