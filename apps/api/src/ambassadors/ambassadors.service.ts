import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ambassadorCreateSchema, ambassadorUpdateSchema } from "@artemis/domain";
import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class AmbassadorsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(guildId: string) {
    if (!guildId) throw new BadRequestException("guildId is required");
    return this.prisma.client.ambassadorProfile.findMany({
      where: { guildId },
      orderBy: [{ active: "desc" }, { displayName: "asc" }],
      include: {
        _count: { select: { tables: true } },
      },
    });
  }

  async get(id: string) {
    const ambassador = await this.prisma.client.ambassadorProfile.findUnique({
      where: { id },
      include: {
        tables: {
          orderBy: { event: { startAt: "desc" } },
          take: 10,
          select: {
            id: true,
            title: true,
            tableType: true,
            event: { select: { id: true, title: true, startAt: true, status: true } },
          },
        },
      },
    });
    if (!ambassador) throw new NotFoundException("Ambassador profile not found");
    return ambassador;
  }

  async create(body: unknown) {
    const input = ambassadorCreateSchema.parse(body);
    return this.prisma.client.ambassadorProfile.upsert({
      where: { guildId_discordUserId: { guildId: input.guildId, discordUserId: input.discordUserId } },
      create: {
        guildId: input.guildId,
        discordUserId: input.discordUserId,
        displayName: input.displayName,
        supportedGameSystems: input.supportedGameSystems,
        defaultSoftCap: input.defaultSoftCap,
        defaultHardCap: input.defaultHardCap,
        defaultTableType: input.defaultTableType,
        notes: input.notes,
        active: true,
      },
      update: {
        displayName: input.displayName,
        active: true,
      },
    });
  }

  async update(id: string, body: unknown) {
    const existing = await this.prisma.client.ambassadorProfile.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Ambassador profile not found");

    const input = ambassadorUpdateSchema.parse(body);
    const data: Record<string, unknown> = {};
    if (input.displayName !== undefined) data.displayName = input.displayName;
    if (input.supportedGameSystems !== undefined) data.supportedGameSystems = input.supportedGameSystems;
    if (input.defaultSoftCap !== undefined) data.defaultSoftCap = input.defaultSoftCap;
    if (input.defaultHardCap !== undefined) data.defaultHardCap = input.defaultHardCap;
    if (input.defaultTableType !== undefined) data.defaultTableType = input.defaultTableType;
    if (input.active !== undefined) data.active = input.active;
    if (input.notes !== undefined) data.notes = input.notes;
    if (input.dmCountLast30Days !== undefined) data.dmCountLast30Days = input.dmCountLast30Days;
    if (input.backupPullCountLast90Days !== undefined) data.backupPullCountLast90Days = input.backupPullCountLast90Days;
    if (input.lastDmDate !== undefined) data.lastDmDate = input.lastDmDate ? new Date(input.lastDmDate) : null;

    return this.prisma.client.ambassadorProfile.update({ where: { id }, data });
  }

  async deregister(id: string) {
    const existing = await this.prisma.client.ambassadorProfile.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Ambassador profile not found");
    return this.prisma.client.ambassadorProfile.update({
      where: { id },
      data: { active: false },
    });
  }
}
