import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import {
  eventSeriesCreateSchema,
  eventTypeUpdateSchema,
  seriesGenerateSchema,
  WEEKDAY_TO_JS,
  makeDateInTimezone,
  nextWeekdayDateInTimezone,
  parseRecurrenceRule,
  calendarDaysBetweenInTimezone,
} from "@artemis/domain";
import { PrismaService } from "../prisma/prisma.service.js";
import { EventsService } from "./events.service.js";
import { createEventType, resolveOwnedEventType } from "./event-type.util.js";

@Injectable()
export class EventSeriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  async create(body: unknown) {
    const input = eventSeriesCreateSchema.parse(body);

    // EventType + EventSeries are created together so a failure partway through
    // never leaves an orphaned EventType row with no owning series.
    return this.prisma.client.$transaction(async (tx) => {
      const eventType = await createEventType(tx, input.guildId, input.eventType, input.defaultGameSystem);
      return tx.eventSeries.create({
        data: {
          guildId: input.guildId,
          eventTypeId: eventType.id,
          name: input.name,
          defaultChannelId: input.defaultChannelId,
          recurrenceRule: input.recurrenceRule,
          signupOpenHoursBefore: input.signupOpenHoursBefore,
          signupCloseHoursBefore: input.signupCloseHoursBefore,
          defaultRoleCleanupDays: input.defaultRoleCleanupDays,
          defaultTitle: input.defaultTitle ?? input.name,
          defaultGameSystem: input.defaultGameSystem,
          defaultDescription: input.defaultDescription,
          defaultImageUrl: input.defaultImageUrl,
          defaultStartHour: input.defaultStartHour,
          defaultStartMinute: input.defaultStartMinute,
          defaultDurationMinutes: input.defaultDurationMinutes,
          shortageAlertHoursBefore: input.shortageAlertHoursBefore ?? null,
          createdByDiscordId: input.createdByDiscordId,
        },
      });
    });
  }

  /**
   * Edit this series' own template signup-option config (affects only
   * occurrences generated after this edit — already-generated occurrences own
   * independent EventType copies). Copy-on-write: if this row predates
   * per-series overrides and is still shared with other events/series, it's
   * cloned first so this edit can never mutate a sibling.
   */
  async updateEventType(id: string, raw: unknown) {
    const input = eventTypeUpdateSchema.parse(raw);
    return this.prisma.client.$transaction(async (tx) => {
      const series = await tx.eventSeries.findUnique({ where: { id }, select: { eventTypeId: true } });
      if (!series) throw new NotFoundException("Series not found");
      const owned = await resolveOwnedEventType(tx, series.eventTypeId, { kind: "series", id });
      return tx.eventType.update({ where: { id: owned.id }, data: input });
    });
  }

  async list(guildId: string) {
    return this.prisma.client.eventSeries.findMany({
      where: { guildId },
      include: { _count: { select: { events: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  async get(seriesId: string) {
    const series = await this.prisma.client.eventSeries.findUnique({
      where: { id: seriesId },
      include: {
        eventType: true,
        events: {
          orderBy: { startAt: "asc" },
          where: { startAt: { gte: new Date() }, status: { not: "CANCELLED" } },
          select: { id: true, title: true, startAt: true, status: true },
        },
        _count: { select: { events: true } },
      },
    });
    if (!series) throw new NotFoundException("Series not found");
    return series;
  }

  /**
   * Generate the next N occurrences after the last existing event in the series.
   * Past events are never touched. Only WEEKLY (optionally biweekly) recurrence
   * is supported in v1. Occurrence times are constructed in the guild's
   * configured IANA timezone so they are DST-safe across spring/fall transitions.
   */
  async generate(seriesId: string, body: unknown) {
    const { count } = seriesGenerateSchema.parse(body ?? {});

    const series = await this.prisma.client.eventSeries.findUnique({
      where: { id: seriesId },
      include: {
        eventType: true,
        events: {
          orderBy: { startAt: "desc" },
          take: 1,
          select: { startAt: true },
        },
      },
    });
    if (!series) throw new NotFoundException("Series not found");

    let weekday: string, intervalWeeks: 1 | 2;
    try {
      ({ weekday, intervalWeeks } = parseRecurrenceRule(series.recurrenceRule));
    } catch {
      throw new BadRequestException(`Invalid recurrence rule: ${series.recurrenceRule}`);
    }
    const dayAbbr = weekday;
    const targetDay = WEEKDAY_TO_JS[dayAbbr];

    // Resolve the guild timezone once for the whole batch.
    const settings = await this.prisma.client.guildSettings.findUnique({
      where: { guildId: series.guildId },
      select: { defaultTimezone: true },
    });
    const tz = settings?.defaultTimezone ?? "America/New_York";

    // Start the day after the last generated event (or today).
    const lastDate = series.events[0]?.startAt ?? new Date();
    let cursor = new Date(lastDate.getTime() + 24 * 60 * 60 * 1000);

    const dateFmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

    // Biweekly parity is measured against a persisted anchor, never re-derived
    // from existing events — deleting/rescheduling an occurrence must not shift
    // the cadence of the rest of the series. Set once, on the very first
    // occurrence this series ever generates.
    let anchor = series.recurrenceAnchorAt;

    // Each occurrence gets its own independent EventType row, cloned from the
    // series' current signup-option values, so editing one occurrence later
    // never affects siblings or the series template.
    const eventTypeOverrides = {
      name: series.eventType.name,
      requiresRsvp: series.eventType.requiresRsvp,
      allowsGuests: series.eventType.allowsGuests,
      maxGuestsPerRsvp: series.eventType.maxGuestsPerRsvp,
      requiresAmbassadors: series.eventType.requiresAmbassadors,
      requiresTableAssignment: series.eventType.requiresTableAssignment,
      usesPlayerCategories: series.eventType.usesPlayerCategories,
      createsTemporaryRoles: series.eventType.createsTemporaryRoles,
      requiresAttendanceConfirmation: series.eventType.requiresAttendanceConfirmation,
      sendsFeedbackPrompts: series.eventType.sendsFeedbackPrompts,
      usesWaitlist: series.eventType.usesWaitlist,
      allowsNameOnlyWalkIns: series.eventType.allowsNameOnlyWalkIns,
    };

    const created: { id: string; startAt: Date }[] = [];
    let maxSkips = count * 10; // safety valve against infinite loops if all slots occupied
    for (let i = 0; i < count; i++) {
      if (maxSkips-- <= 0) break;

      // Find the next calendar day matching the recurrence weekday in the guild tz.
      let occurrenceDate = nextWeekdayDateInTimezone(cursor, targetDay, tz);

      // Biweekly: skip candidate weeks that don't share the anchor's parity.
      // Both dates fall on the same weekday, so the day gap is always a
      // multiple of 7; this loop runs at most once per candidate.
      if (intervalWeeks > 1 && anchor) {
        while (
          (calendarDaysBetweenInTimezone(anchor, occurrenceDate, tz) / 7) % intervalWeeks !==
          0
        ) {
          occurrenceDate = new Date(occurrenceDate.getTime() + 7 * 24 * 60 * 60 * 1000);
        }
      }

      // Extract the calendar date as it appears in the target timezone.
      const parts = dateFmt.formatToParts(occurrenceDate);
      const year = parseInt(parts.find((p) => p.type === "year")!.value, 10);
      const month = parseInt(parts.find((p) => p.type === "month")!.value, 10);
      const day = parseInt(parts.find((p) => p.type === "day")!.value, 10);

      // Build the wall-clock start time in the guild timezone (DST-safe).
      const startAt = makeDateInTimezone(year, month, day, series.defaultStartHour, series.defaultStartMinute, tz);
      const endAt = new Date(startAt.getTime() + series.defaultDurationMinutes * 60 * 1000);

      if (intervalWeeks > 1 && !anchor) {
        anchor = startAt;
        await this.prisma.client.eventSeries.update({
          where: { id: series.id },
          data: { recurrenceAnchorAt: anchor },
        });
      }

      // Idempotency: skip this slot if an event with the same series+startAt
      // already exists (e.g., generated by a concurrent worker or a manual call).
      const duplicate = await this.prisma.client.event.findFirst({
        where: { seriesId: series.id, startAt },
        select: { id: true },
      });
      if (duplicate) {
        cursor = new Date(occurrenceDate.getTime() + 24 * 60 * 60 * 1000);
        i--; // Don't count this duplicate against the requested batch size.
        continue;
      }

      const signupOpensAt = series.signupOpenHoursBefore
        ? new Date(startAt.getTime() - series.signupOpenHoursBefore * 60 * 60 * 1000)
        : undefined;
      const signupClosesAt = new Date(
        startAt.getTime() - series.signupCloseHoursBefore * 60 * 60 * 1000,
      );

      const event = await this.events.create({
        guildId: series.guildId,
        channelId: series.defaultChannelId,
        title: series.defaultTitle || series.name,
        description: series.defaultDescription ?? undefined,
        imageUrl: series.defaultImageUrl ?? undefined,
        eventType: eventTypeOverrides,
        gameSystem: series.defaultGameSystem,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        signupOpensAt: signupOpensAt?.toISOString(),
        signupClosesAt: signupClosesAt.toISOString(),
        shortageAlertHoursBefore: series.shortageAlertHoursBefore ?? undefined,
        createdByDiscordId: series.createdByDiscordId,
        seriesId: series.id,
      });

      created.push({ id: event.id, startAt: event.startAt });
      // Advance cursor past the occurrence just generated (pure ms, no setDate).
      cursor = new Date(occurrenceDate.getTime() + 24 * 60 * 60 * 1000);
    }

    return { created: created.length, events: created };
  }
}
