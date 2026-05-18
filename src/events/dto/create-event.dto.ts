// src/events/dto/create-event.dto.ts
export class CreateEventDto {
  guildId!: string;
  channelId!: string;
  name!: string;
  description?: string;
  startDate!: string;
  endDate!: string;
  rrule?: string;
}
