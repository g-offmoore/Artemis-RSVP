import { BadRequestException, Injectable } from "@nestjs/common";
import { guildSettingsUpdateSchema } from "@artemis/domain";
import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class GuildSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(guildId: string) {
    if (!guildId) throw new BadRequestException("guildId is required");

    return this.prisma.client.guildSettings.upsert({
      where: { guildId },
      update: {},
      create: { guildId },
    });
  }

  async update(guildId: string, body: unknown) {
    if (!guildId) throw new BadRequestException("guildId is required");

    const data = guildSettingsUpdateSchema.parse(body);

    return this.prisma.client.guildSettings.upsert({
      where: { guildId },
      update: data,
      create: { guildId, ...data },
    });
  }
}
