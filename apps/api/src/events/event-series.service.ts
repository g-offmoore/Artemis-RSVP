import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import {
  eventSeriesCreateSchema,
  seriesGenerateSchema,
  WEEKDAY_TO_JS,
  makeDateInTimezone,
  nextWeekdayDateInTimezone,
} from "@artemis/domain";
import { PrismaService } from "../prisma/prisma.service.js";
import { EventsService } from "./events.service.js";

@Injectable()
export class EventSeriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  async create(body: unknown) {
    const input = eventSeriesCreateSchema.parse(body);
    const eventType = await this.prisma.client.eventType.findFirst({
      where: { key: input.eventTypeKey },
    });
    if (!eventType) {
      throw new BadRequestException(`Unknown eventTypeKey: ${input.eventTypeKey}`);
    }
    return this.prisma.client.eventSeries.create({
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
        createdByDiscordId: input.createdByDiscordId,
      },
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
   * Past events are never touched. Only WEEKLY recurrence is supported in v1.
   * Occurrence times are constructed in the guild's configured IANA timezone so
   * they are DST-safe across spring/fall transitions.
   */
  async generate(seriesId: string, body: unknown) {
    const { count } = seriesGenerateSchema.parse(body ?? {});

    const series = await this.prisma.client.eventSeries.findUnique({
      where: { id: seriesId },
      include: {
        events: {
          orderBy: { startAt: "desc" },
          take: 1,
          select: { startAt: true },
        },
      },
    });
    if (!series) throw new NotFoundException("Series not found");

    const [, dayAbbr] = series.recurrenceRule.split(":");
    const targetDay = WEEKDAY_TO_JS[dayAbbr];
    if (targetDay === undefined) {
      throw new BadRequestException(`Invalid recurrenceRule: ${series.recurrenceRule}`);
    }

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

    const created: { id: string; startAt: Date }[] = [];
    for (let i = 0; i < count; i++) {
      // Find the next calendar day matching the recurrence weekday in the guild tz.
      const occurrenceDate = nextWeekdayDateInTimezone(cursor, targetDay, tz);

      // Extract the calendar date as it appears in the target timezone.
      const parts = dateFmt.formatToParts(occurrenceDate);
      const year = parseInt(parts.find((p) => p.type === "year")!.value, 10);
      const month = parseInt(parts.find((p) => p.type === "month")!.value, 10);
      const day = parseInt(parts.find((p) => p.type === "day")!.value, 10);

      // Build the wall-clock start time in the guild timezone (DST-safe).
      const startAt = makeDateInTimezone(year, month, day, series.defaultStartHour, series.defaultStartMinute, tz);
      const endAt = new Date(startAt.getTime() + series.defaultDurationMinutes * 60 * 1000);

      const event = await this.events.create({
        guildId: series.guildId,
        channelId: series.defaultChannelId,
        title: series.defaultTitle || series.name,
        description: series.defaultDescription ?? undefined,
        imageUrl: series.defaultImageUrl ?? undefined,
        gameSystem: series.defaultGameSystem,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
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
