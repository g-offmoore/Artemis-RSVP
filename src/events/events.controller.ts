// src/events/events.controller.ts

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { EventsService }      from './events.service';
import { CreateEventDto }     from './dto/create-event.dto';
import { UpdateRsvpDto }      from './dto/update-rsvp.dto';

@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  /** 
   * POST /events 
   * Body: CreateEventDto
   */
  @Post()
  create(@Body() dto: CreateEventDto) {
    return this.eventsService.create(dto);
  }

  /** 
   * GET /events?guildId=...
   */
  @Get()
  findAll(@Query('guildId') guildId: string) {
    return this.eventsService.findAll(guildId);
  }

  /** 
   * DELETE /events/:id 
   */
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.eventsService.remove(id);
  }

  /** 
   * POST /events/:id/rsvp 
   * Body: { userId: string }
   */
  @Post(':id/rsvp')
  rsvp(
    @Param('id') id: string,
    @Body('userId') userId: string,
  ) {
    return this.eventsService.rsvp(id, userId);
  }

  /** 
   * PATCH /events/:id/rsvp 
   * Body: UpdateRsvpDto
   */
  @Patch(':id/rsvp')
  updateRsvp(
    @Param('id') id: string,
    @Body() dto: UpdateRsvpDto,
  ) {
    return this.eventsService.updateRsvp(id, dto);
  }
}
