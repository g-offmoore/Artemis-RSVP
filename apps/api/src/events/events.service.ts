import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  assignParticipantsToTables,
  eventCreateSchema,
  eventUpdateSchema,
  guestUpdateSchema,
  rsvpCreateSchema,
  tableCreateSchema,
} from "@artemis/domain";
import { z } from "zod";
import { AlertService } from "../common/alert.service.js";
import { MetricsService } from "../metrics/metrics.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

const attendanceInputSchema = z.object({
  actorDiscordId: z.string().min(1),
  records: z.array(
    z.object({
      eventParticipantId: z.string().min(1),
      eventTableId: z.string().min(1).optional(),
      rsvpId: z.string().min(1).optional(),
      status: z.enum(["ATTENDED", "NO_SHOW", "WALK_IN", "EXCUSED", "UNKNOWN"]),
      notes: z.string().optional(),
    }),
  ),
});

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    private readonly alerts: AlertService,
  ) {}

  async list(guildId: string) {
    if (!guildId) throw new BadRequestException("guildId is required");

    const events = await this.prisma.client.event.findMany({
      where: {
        guildId,
        status: { notIn: ["CANCELLED", "ARCHIVED"] },
        endAt: { gte: new Date() },
      },
      orderBy: { startAt: "asc" },
      take: 50,
      include: {
        participants: { where: { assignmentEligible: true } },
        tables: { where: { status: { notIn: ["CANCELLED", "COMPLETED"] } } },
      },
    });

    return events.map(({ participants, tables, ...event }) => ({
      ...event,
      tables,
      _count: { participants: participants.length, tables: tables.length },
    }));
  }

  async get(id: string) {
    const event = await this.prisma.client.event.findUnique({
      where: { id },
      include: {
        eventType: true,
        tables: { include: { ambassadorProfile: true, assignments: true } },
        rsvps: { include: { participants: true } },
        participants: true,
        assignments: true,
        attendanceRecords: true,
        feedbackRequests: true,
        roles: true,
        auditLogs: { orderBy: { createdAt: "desc" }, take: 25 },
      },
    });

    if (!event) throw new NotFoundException("Event not found");
    return event;
  }

  async create(raw: unknown) {
    const input = eventCreateSchema.parse(raw);
    if (input.endAt <= input.startAt)
      throw new BadRequestException("endAt must be after startAt");
    if (input.startAt.getTime() < Date.now() - 60 * 60 * 1000) {
      throw new BadRequestException(
        "startAt must be in the future. Include the full event date and time.",
      );
    }
    if (input.signupClosesAt && input.signupClosesAt > input.startAt) {
      throw new BadRequestException("signupClosesAt must be before startAt");
    }
    if (
      input.signupOpensAt &&
      input.signupClosesAt &&
      input.signupOpensAt >= input.signupClosesAt
    ) {
      throw new BadRequestException(
        "signupOpensAt must be before signupClosesAt",
      );
    }

    const eventType = await this.ensureEventType(
      input.eventTypeKey,
      input.gameSystem,
    );
    const roleCleanupAt = new Date(
      input.endAt.getTime() + 14 * 24 * 60 * 60 * 1000,
    );

    const event = await this.prisma.client.event.create({
      data: {
        guildId: input.guildId,
        channelId: input.channelId,
        title: input.title,
        description: input.description,
        imageUrl: input.imageUrl,
        eventTypeId: eventType.id,
        gameSystem: input.gameSystem,
        startAt: input.startAt,
        endAt: input.endAt,
        signupOpensAt: input.signupOpensAt,
        signupClosesAt: input.signupClosesAt,
        roleCleanupAt,
        createdByDiscordId: input.createdByDiscordId,
        auditLogs: {
          create: {
            guildId: input.guildId,
            actorDiscordId: input.createdByDiscordId,
            action: "event.created",
            afterValue: input,
          },
        },
      },
      include: { eventType: true },
    });

    return event;
  }

  async update(id: string, raw: unknown) {
    const input = eventUpdateSchema.parse(raw);
    const existing = await this.prisma.client.event.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException("Event not found");

    const startAt = input.startAt ?? existing.startAt;
    const endAt = input.endAt ?? existing.endAt;
    if (endAt <= startAt)
      throw new BadRequestException("endAt must be after startAt");

    const updates: Record<string, unknown> = {};
    if (input.title !== undefined) updates.title = input.title;
    if (input.description !== undefined)
      updates.description = input.description;
    if (input.imageUrl !== undefined) updates.imageUrl = input.imageUrl;
    if (input.gameSystem !== undefined) updates.gameSystem = input.gameSystem;
    if (input.startAt !== undefined) updates.startAt = input.startAt;
    if (input.endAt !== undefined) updates.endAt = input.endAt;

    return this.prisma.client.event.update({
      where: { id },
      data: {
        ...updates,
        auditLogs: {
          create: {
            guildId: existing.guildId,
            actorDiscordId: input.actorDiscordId,
            action: "event.updated",
            afterValue: updates,
          },
        },
      },
    });
  }

  async cancel(id: string, actorDiscordId: string) {
    const existing = await this.prisma.client.event.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException("Event not found");

    return this.prisma.client.event.update({
      where: { id },
      data: {
        status: "CANCELLED",
        auditLogs: {
          create: {
            guildId: existing.guildId,
            actorDiscordId,
            action: "event.cancelled",
            beforeValue: { status: existing.status },
            afterValue: { status: "CANCELLED" },
          },
        },
      },
    });
  }

  async rsvp(eventId: string, raw: unknown) {
    const input = rsvpCreateSchema.parse(raw);
    const event = await this.prisma.client.event.findUnique({
      where: { id: eventId },
      include: { eventType: true },
    });
    if (!event) throw new NotFoundException("Event not found");
    const selectedCategory = usesDndCategories(event.gameSystem)
      ? input.selectedCategory
      : ("MIXED" as const);

    return this.prisma.client.$transaction(async (tx) => {
      const profile = await tx.playerProfile.upsert({
        where: {
          guildId_discordUserId: {
            guildId: event.guildId,
            discordUserId: input.discordUserId,
          },
        },
        create: {
          guildId: event.guildId,
          discordUserId: input.discordUserId,
          displayName: input.displayName,
          defaultCategory: selectedCategory,
        },
        update: {
          displayName: input.displayName,
          roleDetectedCategory: selectedCategory,
        },
      });

      const rsvp = await tx.rSVP.upsert({
        where: {
          eventId_primaryDiscordUserId: {
            eventId,
            primaryDiscordUserId: input.discordUserId,
          },
        },
        create: {
          eventId,
          primaryDiscordUserId: input.discordUserId,
          playerProfileId: profile.id,
          selectedCategory,
          partyKey: input.discordUserId,
          source: input.source,
        },
        update: {
          selectedCategory,
          status: "GOING",
        },
      });

      const primary = await tx.eventParticipant.upsert({
        where: { id: `${eventId}:${input.discordUserId}:primary` },
        create: {
          id: `${eventId}:${input.discordUserId}:primary`,
          eventId,
          rsvpId: rsvp.id,
          playerProfileId: profile.id,
          participantType: "PRIMARY",
          discordUserId: input.discordUserId,
          displayName: input.displayName,
          playerCategory: selectedCategory,
          partyKey: input.discordUserId,
          createdByDiscordId: input.discordUserId,
        },
        update: {
          displayName: input.displayName,
          playerCategory: selectedCategory,
          confirmationStatus: "UNKNOWN",
        },
      });

      await tx.auditLog.create({
        data: {
          guildId: event.guildId,
          eventId,
          actorDiscordId: input.discordUserId,
          action: "rsvp.upserted",
          afterValue: {
            rsvpId: rsvp.id,
            participantId: primary.id,
            selectedCategory,
          },
        },
      });

      return tx.rSVP.findUnique({
        where: { id: rsvp.id },
        include: { participants: true },
      });
    });
  }

  async updateGuests(eventId: string, discordUserId: string, raw: unknown) {
    const input = guestUpdateSchema.parse({
      ...(typeof raw === "object" && raw ? raw : {}),
      discordUserId,
    });
    const event = await this.prisma.client.event.findUnique({
      where: { id: eventId },
      include: { eventType: true },
    });
    if (!event) throw new NotFoundException("Event not found");
    if (input.guests.length > event.eventType.maxGuestsPerRsvp) {
      throw new BadRequestException(
        `This event allows at most ${event.eventType.maxGuestsPerRsvp} guests`,
      );
    }

    const rsvp = await this.prisma.client.rSVP.findUnique({
      where: {
        eventId_primaryDiscordUserId: {
          eventId,
          primaryDiscordUserId: discordUserId,
        },
      },
      include: { participants: true },
    });
    if (!rsvp) throw new NotFoundException("RSVP not found");

    return this.prisma.client.$transaction(async (tx) => {
      await tx.eventParticipant.deleteMany({
        where: { eventId, rsvpId: rsvp.id, participantType: "GUEST" },
      });

      for (const guest of input.guests) {
        const guestProfile = guest.discordUserId
          ? await tx.playerProfile.upsert({
              where: {
                guildId_discordUserId: {
                  guildId: event.guildId,
                  discordUserId: guest.discordUserId,
                },
              },
              create: {
                guildId: event.guildId,
                discordUserId: guest.discordUserId,
                displayName: guest.displayName,
              },
              update: { displayName: guest.displayName },
            })
          : null;

        await tx.eventParticipant.create({
          data: {
            eventId,
            rsvpId: rsvp.id,
            playerProfileId: guestProfile?.id,
            participantType: "GUEST",
            discordUserId: guest.discordUserId,
            enteredName: guest.discordUserId ? undefined : guest.displayName,
            displayName: guest.displayName,
            playerCategory: rsvp.selectedCategory,
            partyKey: rsvp.partyKey,
            partyOwnerParticipantId: `${eventId}:${discordUserId}:primary`,
            feedbackEligible: Boolean(guest.discordUserId),
            messageEligible: Boolean(guest.discordUserId),
            roleEligible: Boolean(guest.discordUserId),
            createdByDiscordId: discordUserId,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          guildId: event.guildId,
          eventId,
          actorDiscordId: discordUserId,
          action: "rsvp.guests.updated",
          afterValue: { guestCount: input.guests.length },
        },
      });

      return tx.rSVP.findUnique({
        where: { id: rsvp.id },
        include: { participants: true },
      });
    });
  }

  async cancelRsvp(eventId: string, discordUserId: string) {
    const event = await this.prisma.client.event.findUnique({
      where: { id: eventId },
    });
    if (!event) throw new NotFoundException("Event not found");

    return this.prisma.client.rSVP.update({
      where: {
        eventId_primaryDiscordUserId: {
          eventId,
          primaryDiscordUserId: discordUserId,
        },
      },
      data: {
        status: "CANCELLED",
        participants: {
          updateMany: {
            where: {},
            data: { assignmentEligible: false, attendanceEligible: false },
          },
        },
        event: {
          update: {
            auditLogs: {
              create: {
                guildId: event.guildId,
                actorDiscordId: discordUserId,
                action: "rsvp.cancelled",
                afterValue: { discordUserId },
              },
            },
          },
        },
      },
    });
  }

  async createTable(eventId: string, raw: unknown) {
    const input = tableCreateSchema.parse(raw);
    const event = await this.prisma.client.event.findUnique({
      where: { id: eventId },
      include: { eventType: true },
    });
    if (!event) throw new NotFoundException("Event not found");
    const tableType = usesDndCategories(event.gameSystem)
      ? input.tableType
      : ("MIXED" as const);
    const effectiveInput = { ...input, tableType };

    const ambassador = await this.prisma.client.ambassadorProfile.upsert({
      where: {
        guildId_discordUserId: {
          guildId: event.guildId,
          discordUserId: input.ambassadorDiscordId,
        },
      },
      create: {
        guildId: event.guildId,
        discordUserId: input.ambassadorDiscordId,
        displayName: input.ambassadorDisplayName ?? input.ambassadorDiscordId,
        defaultTableType: tableType,
        defaultSoftCap: input.softCap,
        defaultHardCap: input.hardCap,
      },
      update: {
        active: true,
        displayName: input.ambassadorDisplayName ?? undefined,
      },
    });

    return this.prisma.client.$transaction(async (tx) => {
      const data = {
        title: input.title ?? `${ambassador.displayName}'s Table`,
        tableType,
        softCap: input.softCap,
        hardCap: input.hardCap,
        description: input.description,
      };
      const existing = await tx.eventTable.findFirst({
        where: {
          eventId,
          ambassadorProfileId: ambassador.id,
          status: { not: "CANCELLED" },
        },
      });
      const table = existing
        ? await tx.eventTable.update({
            where: { id: existing.id },
            data,
          })
        : await tx.eventTable.create({
            data: {
              eventId,
              ambassadorProfileId: ambassador.id,
              ...data,
            },
          });

      await tx.auditLog.create({
        data: {
          guildId: event.guildId,
          eventId,
          actorDiscordId: input.ambassadorDiscordId,
          action: existing ? "table.updated" : "table.created",
          afterValue: effectiveInput,
        },
      });

      return table;
    });
  }

  async runAssignments(eventId: string, actorDiscordId: string) {
    const event = await this.prisma.client.event.findUnique({
      where: { id: eventId },
      include: {
        tables: { include: { assignments: true } },
        participants: { include: { assignments: true } },
      },
    });
    if (!event) throw new NotFoundException("Event not found");

    try {
      const participants = event.participants
        .filter((participant) => participant.assignmentEligible)
        .map((participant) => ({
          id: participant.id,
          displayName: participant.displayName,
          partyKey: participant.partyKey,
          category: participant.playerCategory,
          lockedTableId:
            participant.assignments.find(
              (assignment) =>
                assignment.locked && assignment.status === "ASSIGNED",
            )?.eventTableId ?? null,
        }));

      const tables = event.tables.map((table) => ({
        id: table.id,
        title: table.title,
        tableType: table.tableType,
        softCap: table.softCap,
        hardCap: table.hardCap,
        locked: table.locked || table.status === "LOCKED",
        existingParticipantIds: table.assignments
          .filter(
            (assignment) =>
              assignment.locked && assignment.status === "ASSIGNED",
          )
          .map((assignment) => assignment.eventParticipantId),
      }));

      const result = assignParticipantsToTables(participants, tables);

      await this.prisma.client.$transaction(async (tx) => {
        await tx.assignment.updateMany({
          where: {
            eventId,
            locked: false,
            status: { in: ["ASSIGNED", "WAITLISTED", "UNASSIGNED"] },
          },
          data: {
            status: "REMOVED",
            reason: "Removed by assignment recalculation",
          },
        });

        for (const decision of result.decisions) {
          await tx.assignment.create({
            data: {
              eventId,
              eventParticipantId: decision.participantId,
              eventTableId: decision.tableId,
              status: decision.status,
              reason: decision.reason,
              assignedBy: actorDiscordId,
            },
          });
        }

        await tx.auditLog.create({
          data: {
            guildId: event.guildId,
            eventId,
            actorDiscordId,
            action: "assignment.recalculated",
            afterValue: result,
          },
        });
      });

      return result;
    } catch (error) {
      this.metrics.assignmentFailures.inc();
      await this.alerts.sendOpsAlert("Assignment run failed", {
        eventId,
        actorDiscordId,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async confirmAttendance(eventId: string, raw: unknown) {
    const input = attendanceInputSchema.parse(raw);
    const event = await this.prisma.client.event.findUnique({
      where: { id: eventId },
    });
    if (!event) throw new NotFoundException("Event not found");

    return this.prisma.client.$transaction(async (tx) => {
      for (const record of input.records) {
        await tx.attendanceRecord.upsert({
          where: {
            eventId_eventParticipantId: {
              eventId,
              eventParticipantId: record.eventParticipantId,
            },
          },
          create: {
            eventId,
            eventParticipantId: record.eventParticipantId,
            eventTableId: record.eventTableId,
            rsvpId: record.rsvpId,
            status: record.status,
            notes: record.notes,
            confirmedByDiscordId: input.actorDiscordId,
          },
          update: {
            eventTableId: record.eventTableId,
            status: record.status,
            notes: record.notes,
            confirmedByDiscordId: input.actorDiscordId,
            confirmedAt: new Date(),
          },
        });

        await tx.eventParticipant.update({
          where: { id: record.eventParticipantId },
          data: { confirmationStatus: record.status },
        });
      }

      await tx.auditLog.create({
        data: {
          guildId: event.guildId,
          eventId,
          actorDiscordId: input.actorDiscordId,
          action: "attendance.confirmed",
          afterValue: { count: input.records.length },
        },
      });

      return { ok: true, count: input.records.length };
    });
  }

  async refreshDbConnectionMetric() {
    const rows = await this.prisma.client.$queryRaw<
      Array<{ count: bigint | number }>
    >`
      SELECT count(*)::int AS count
      FROM pg_stat_activity
      WHERE datname = current_database()
    `;
    const count = Number(rows[0]?.count ?? 0);
    const limit = Number.parseInt(
      process.env.DATABASE_PLAN_MAX_CONNECTIONS ?? "25",
      10,
    );
    const threshold = Number.parseFloat(
      process.env.DATABASE_CONNECTION_ALERT_THRESHOLD ?? "0.7",
    );

    this.metrics.dbConnections.set(count);
    this.metrics.dbConnectionLimit.set(limit);

    if (count >= limit * threshold) {
      await this.alerts.sendOpsAlert(
        "Database connection usage exceeded threshold",
        { count, limit, threshold },
      );
    }
  }

  private async ensureEventType(key: string, gameSystem: string) {
    return this.prisma.client.eventType.upsert({
      where: { key },
      create: {
        key,
        name: key === "dnd_session_night" ? "D&D Session Night" : key,
        defaultGameSystem: gameSystem,
      },
      update: {},
    });
  }
}

function usesDndCategories(gameSystem: string) {
  const value = gameSystem.trim().toLowerCase();
  return value === "d&d" || value === "dnd" || value.includes("dungeons");
}
