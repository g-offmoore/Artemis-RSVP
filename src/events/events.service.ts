// src/events/events.service.ts

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService }                from '../prisma/prisma.service';
import { CreateEventDto }               from './dto/create-event.dto';
import { UpdateRsvpDto }                from './dto/update-rsvp.dto';

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new event.
   */
  async create(dto: CreateEventDto) {
    return this.prisma.event.create({
      data: {
        guildId:     dto.guildId,
        channelId:   dto.channelId,
        name:        dto.name,
        description: dto.description,
        startDate:   new Date(dto.startDate),
        endDate:     new Date(dto.endDate),
        rrule:       dto.rrule,
      },
    });
  }

  /**
   * List all upcoming events for a guild, including their RSVPs.
   */
  async findAll(guildId: string) {
    return this.prisma.event.findMany({
      where:   { guildId },
      orderBy: { startDate: 'asc' },
      include: { RSVPs: true },
    });
  }

  /**
   * Delete an event by ID.
   */
  async remove(id: string) {
    await this.prisma.event.delete({ where: { id } });
    return { success: true };
  }

  /**
   * Quick one-click RSVP (creates or no-ops if already exists).
   * The `status` field is omitted here so Prisma uses your schema default (Confirmed).
   */
  async rsvp(eventId: string, userId: string) {
    // Ensure the event exists
    const evt = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!evt) {
      throw new NotFoundException(`Event with ID ${eventId} not found`);
    }

    // Upsert the RSVP record, letting the DB default status to “Confirmed”
    return this.prisma.rSVP.upsert({
      where:  { eventId_userId: { eventId, userId } },
      create: {
        eventId,
        userId,
        guests:     0,
        guestNames: [],
        // status omitted → @default(Confirmed) in your schema will apply
      },
      update: {},  // no changes on duplicate
    });
  }

  /**
   * Update an existing RSVP with guest count & names.
   */
  async updateRsvp(eventId: string, dto: UpdateRsvpDto) {
    const { userId, guests, guestNames } = dto;

    // Ensure the RSVP exists
    const existing = await this.prisma.rSVP.findUnique({
      where: { eventId_userId: { eventId, userId } },
    });
    if (!existing) {
      throw new NotFoundException(
        `No RSVP found for user ${userId} on event ${eventId}`,
      );
    }

    // Persist the updates
    return this.prisma.rSVP.update({
      where: {
        eventId_userId: { eventId, userId },
      },
      data: {
        guests,
        guestNames,
      },
    });
  }
}
