import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import {
  eventSeriesCreateSchema,
  eventTypeUpdateSchema,
  seriesGenerateSchema,
  WEEKDAY_TO_JS,
  makeDateInTimezone,
  nextWeekdayDateInTimezone,
  parseRecurrenceRule,
  calendarDaysBetweenInTimezone,
  cursorAfterOccurrenceKey,
  occurrenceKeyFor,
  parseOccurrenceKey,
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
   * Generate the next N occurrence slots after the latest existing slot in the
   * series. Past events are never touched. Only WEEKLY (optionally biweekly)
   * recurrence is supported in v1. Occurrence times are constructed in the guild
   * timezone so they are DST-safe across spring/fall transitions.
   *
   * Concurrency (F03): every occurrence has a stable slot key that is unique per
   * series, so simultaneous calls cannot create the same slot twice; a caller
   * that loses the race reports the winner's event as part of its batch. A
   * cancelled or moved occurrence keeps its key, so its slot is never
   * regenerated. Passing `requestId` makes a retried request return the
   * original batch.
   */
  async generate(seriesId: string, body: unknown): Promise<GenerateResult> {
    const { count, requestId } = seriesGenerateSchema.parse(body ?? {});

    const exists = await this.prisma.client.eventSeries.findUnique({
      where: { id: seriesId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException("Series not found");

    if (!requestId) return this.generateBatch(seriesId, count);

    try {
      await this.prisma.client.seriesGenerationRequest.create({
        data: { seriesId, requestId, count },
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const prior = await this.prisma.client.seriesGenerationRequest.findUnique({
        where: { seriesId_requestId: { seriesId, requestId } },
      });
      if (prior?.result) return prior.result as unknown as GenerateResult;
      throw new ConflictException("This generation request is still in progress");
    }

    let result: GenerateResult;
    try {
      result = await this.generateBatch(seriesId, count);
    } catch (err) {
      // Release the key so the caller can retry a request that failed.
      await this.prisma.client.seriesGenerationRequest
        .delete({ where: { seriesId_requestId: { seriesId, requestId } } })
        .catch(() => undefined);
      throw err;
    }
    await this.prisma.client.seriesGenerationRequest.update({
      where: { seriesId_requestId: { seriesId, requestId } },
      data: { result: JSON.parse(JSON.stringify(result)) },
    });
    return result;
  }

  private async generateBatch(seriesId: string, count: number): Promise<GenerateResult> {
    const series = await this.prisma.client.eventSeries.findUnique({
      where: { id: seriesId },
      include: { eventType: true },
    });
    if (!series) throw new NotFoundException("Series not found");

    let weekday: string, intervalWeeks: 1 | 2;
    try {
      ({ weekday, intervalWeeks } = parseRecurrenceRule(series.recurrenceRule));
    } catch {
      throw new BadRequestException(`Invalid recurrence rule: ${series.recurrenceRule}`);
    }
    const targetDay = WEEKDAY_TO_JS[weekday];

    // Resolve the guild timezone once for the whole batch.
    const settings = await this.prisma.client.guildSettings.findUnique({
      where: { guildId: series.guildId },
      select: { defaultTimezone: true },
    });
    const tz = settings?.defaultTimezone ?? "America/New_York";

    // Continue after the latest slot ever generated, including cancelled
    // tombstones and occurrences that were moved to another day. With no slots
    // yet, start from now (today itself is excluded).
    const latest = await this.prisma.client.event.findFirst({
      where: { seriesId: series.id, occurrenceKey: { not: null } },
      orderBy: { occurrenceKey: "desc" },
      select: { occurrenceKey: true },
    });
    let cursor = latest?.occurrenceKey ? cursorAfterOccurrenceKey(latest.occurrenceKey, tz) : new Date();

    // Biweekly parity is measured against a persisted anchor, never re-derived
    // from existing events. It is set once with a conditional write so that
    // concurrent first generations agree on one anchor.
    let anchor = series.recurrenceAnchorAt;
    if (intervalWeeks > 1 && !anchor) {
      const first = nextWeekdayDateInTimezone(cursor, targetDay, tz);
      const { year, month, day } = parseOccurrenceKey(occurrenceKeyFor(first, tz));
      const candidate = makeDateInTimezone(year, month, day, series.defaultStartHour, series.defaultStartMinute, tz);
      await this.prisma.client.eventSeries.updateMany({
        where: { id: series.id, recurrenceAnchorAt: null },
        data: { recurrenceAnchorAt: candidate },
      });
      const reread = await this.prisma.client.eventSeries.findUnique({
        where: { id: series.id },
        select: { recurrenceAnchorAt: true },
      });
      anchor = reread?.recurrenceAnchorAt ?? candidate;
    }

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

    const events: GenerateResult["events"] = [];
    let created = 0;
    for (let i = 0; i < count; i++) {
      // Next calendar day matching the recurrence weekday in the guild tz.
      let occurrenceDate = nextWeekdayDateInTimezone(cursor, targetDay, tz);

      // Biweekly: skip candidate weeks that don't share the anchor's parity.
      if (intervalWeeks > 1 && anchor) {
        while ((calendarDaysBetweenInTimezone(anchor, occurrenceDate, tz) / 7) % intervalWeeks !== 0) {
          occurrenceDate = new Date(occurrenceDate.getTime() + 7 * 24 * 60 * 60 * 1000);
        }
      }
      cursor = occurrenceDate;

      const occurrenceKey = occurrenceKeyFor(occurrenceDate, tz);
      const { year, month, day } = parseOccurrenceKey(occurrenceKey);
      const startAt = makeDateInTimezone(year, month, day, series.defaultStartHour, series.defaultStartMinute, tz);
      const endAt = new Date(startAt.getTime() + series.defaultDurationMinutes * 60 * 1000);

      // A slot that already exists was created by a concurrent request; report
      // it as part of this batch rather than also creating the following slot.
      const existing = await this.findSlot(series.id, occurrenceKey);
      if (existing) {
        events.push({ ...existing, occurrenceKey, existing: true });
        continue;
      }

      const signupOpensAt = series.signupOpenHoursBefore
        ? new Date(startAt.getTime() - series.signupOpenHoursBefore * 60 * 60 * 1000)
        : undefined;
      const signupClosesAt = new Date(startAt.getTime() - series.signupCloseHoursBefore * 60 * 60 * 1000);

      try {
        const event = await this.events.create(
          {
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
          },
          { occurrenceKey },
        );
        events.push({ id: event.id, startAt: event.startAt, occurrenceKey, existing: false });
        created++;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        // Lost the race for this slot between the check and the insert.
        const winner = await this.findSlot(series.id, occurrenceKey);
        if (!winner) throw err;
        events.push({ ...winner, occurrenceKey, existing: true });
      }
    }

    return { created, events };
  }

  private findSlot(seriesId: string, occurrenceKey: string) {
    return this.prisma.client.event.findUnique({
      where: { seriesId_occurrenceKey: { seriesId, occurrenceKey } },
      select: { id: true, startAt: true },
    });
  }
}

export type GenerateResult = {
  created: number;
  events: Array<{ id: string; startAt: Date; occurrenceKey: string; existing: boolean }>;
};

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002";
}
