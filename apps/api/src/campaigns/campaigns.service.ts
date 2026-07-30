import { Injectable, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "../prisma/prisma.service.js";

const campaignCreateSchema = z.object({
  guildId: z.string().min(1),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  dmDiscordUserId: z.string().optional(),
});

const campaignUpdateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  status: z.enum(["ACTIVE", "COMPLETED", "ARCHIVED"]).optional(),
  dmDiscordUserId: z.string().optional(),
});

@Injectable()
export class CampaignsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(guildId: string) {
    return this.prisma.client.campaign.findMany({
      where: { guildId },
      orderBy: { createdAt: "desc" },
    });
  }

  async get(id: string) {
    const campaign = await this.prisma.client.campaign.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundException("Campaign not found");
    return campaign;
  }

  async create(raw: unknown) {
    const input = campaignCreateSchema.parse(raw);
    return this.prisma.client.campaign.create({ data: input });
  }

  async update(id: string, raw: unknown) {
    const input = campaignUpdateSchema.parse(raw);
    const campaign = await this.prisma.client.campaign.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundException("Campaign not found");
    return this.prisma.client.campaign.update({ where: { id }, data: input });
  }
}
