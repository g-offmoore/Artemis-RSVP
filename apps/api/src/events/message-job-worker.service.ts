import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { backupDmCustomId } from "@artemis/domain";
import { PrismaService } from "../prisma/prisma.service.js";
import { JobsService } from "../jobs/jobs.service.js";
import { MessageJobsService } from "./message-jobs.service.js";

const JOB_NAME = "artemis.message-job-poll";

// Shape returned by listBackupDmCandidates (plain objects, not full service).
type BackupCandidate = {
  discordUserId: string;
  participantId: string | null;
  backupDmStatus: string | null;
};

@Injectable()
export class MessageJobWorkerService implements OnModuleInit {
  private readonly logger = new Logger(MessageJobWorkerService.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly messageJobs: MessageJobsService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit() {
    if (process.env.ARTEMIS_STARTUP_CHECK === "true") return;
    if (!this.jobs.isReady()) {
      this.logger.warn("pg-boss not ready; message job worker not registered");
      return;
    }

    const boss = this.jobs.client;

    // Queue must exist before schedule() references it.
    // Swallow "already exists" so restarts are idempotent.
    try {
      await boss.createQueue(JOB_NAME);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.toLowerCase().includes("already exists")) throw err;
    }

    await boss.schedule(JOB_NAME, "* * * * *", {});
    await boss.work(JOB_NAME, async () => {
      await this.runPoll();
    });

    this.logger.log("Message job worker registered (cron: every minute)");
  }

  private async runPoll() {
    const token = process.env.DISCORD_TOKEN;
    if (!token) {
      this.logger.warn("DISCORD_TOKEN not set; skipping message job poll");
      return;
    }

    const { processed, failed } = await this.messageJobs.processDueJobs(
      async (job) => {
        await this.dispatchJob(job, token);
      },
    );

    if (processed > 0 || failed > 0) {
      this.logger.log(`Message job poll: processed=${processed} failed=${failed}`);
    }
  }

  private async dispatchJob(
    job: { id: string; messageType: string; targetId: string; eventId: string },
    token: string,
  ) {
    switch (job.messageType) {
      case "PRE_EVENT":
      case "POST_EVENT":
        await this.sendChannelMessage(job, token);
        break;
      case "REMINDER":
        await this.sendOrganizerWarning(job, token);
        break;
      case "CUSTOM":
        await this.sendBackupDmAsk(job, token);
        break;
      default:
        this.logger.warn(`Unknown messageType ${job.messageType} for job ${job.id}`);
    }
  }

  // ─── PRE_EVENT / POST_EVENT ───────────────────────────────────────────────

  private async sendChannelMessage(
    job: { id: string; messageType: string; targetId: string; eventId: string },
    token: string,
  ) {
    const event = await this.prisma.client.event.findUnique({
      where: { id: job.eventId },
      select: { title: true, startAt: true, endAt: true },
    });
    if (!event) throw new Error(`Event ${job.eventId} not found for job ${job.id}`);

    const content = buildSimpleContent(job.messageType, event);
    await discordChannelPost(token, job.targetId, { content });
  }

  // ─── REMINDER (T-4h organizer warning) ───────────────────────────────────

  private async sendOrganizerWarning(
    job: { id: string; eventId: string; targetId: string },
    token: string,
  ) {
    const event = await this.prisma.client.event.findUnique({
      where: { id: job.eventId },
      include: {
        tables: { where: { status: { notIn: ["CANCELLED", "COMPLETED"] } } },
        participants: {
          where: { assignmentEligible: true },
          include: {
            assignments: {
              where: {
                status: { in: ["PROJECTED_SEATED", "CONFIRMED_SEATED", "ASSIGNED"] },
              },
            },
          },
        },
        rsvps: { where: { signupRole: "BACKUP_DM", status: "GOING" } },
      },
    });
    if (!event) throw new Error(`Event ${job.eventId} not found for reminder job ${job.id}`);

    const startTs = discordTs(event.startAt, "F");
    const relTs = discordTs(event.startAt, "R");

    // Count seated vs waitlisted per track.
    const seatedIds = new Set(
      event.participants.flatMap((p) => p.assignments.map((a) => a.eventParticipantId)),
    );
    const byTrack = { NORMAL: { seated: 0, waitlisted: 0 }, HEROIC: { seated: 0, waitlisted: 0 }, MIXED: { seated: 0, waitlisted: 0 } };
    for (const p of event.participants) {
      const track = (p.playerCategory ?? "MIXED") as keyof typeof byTrack;
      if (!byTrack[track]) continue;
      if (seatedIds.has(p.id)) byTrack[track].seated++;
      else byTrack[track].waitlisted++;
    }

    // DM coverage: which tracks have at least one table?
    const tablesByTrack = new Map<string, number>();
    for (const t of event.tables) {
      tablesByTrack.set(t.tableType, (tablesByTrack.get(t.tableType) ?? 0) + 1);
    }

    // Backup DM candidates available.
    const backupCount = event.rsvps.length;

    // Lock time based on offset.
    const lockAt = new Date(event.startAt.getTime() - (event as any).assignmentLockOffsetMinutes * 60_000);
    const lockTs = discordTs(lockAt, "R");

    const trackLines = (Object.entries(byTrack) as Array<[string, { seated: number; waitlisted: number }]>)
      .filter(([, v]) => v.seated + v.waitlisted > 0)
      .map(([track, v]) => {
        const tables = tablesByTrack.get(track) ?? 0;
        const dmWarn = tables === 0 ? " ⚠️ NO DM" : "";
        return `${track}: ${v.seated} seated, ${v.waitlisted} waitlisted — ${tables} table(s)${dmWarn}`;
      })
      .join("\n");

    const content =
      `📋 **${event.title}** — organizer warning\n` +
      `Starts ${startTs} (${relTs})\n\n` +
      (trackLines ? `**Seating status:**\n${trackLines}\n\n` : "") +
      `**Backup DMs available:** ${backupCount}\n` +
      `**Assignment lock:** ${lockTs}`;

    await discordChannelPost(token, job.targetId, { content });
  }

  // ─── CUSTOM (T-3h backup DM consent ask) ─────────────────────────────────

  private async sendBackupDmAsk(
    job: { id: string; eventId: string; targetId: string },
    token: string,
  ) {
    const event = await this.prisma.client.event.findUnique({
      where: { id: job.eventId },
      include: {
        tables: { where: { status: { notIn: ["CANCELLED", "COMPLETED"] } } },
        participants: {
          where: { assignmentEligible: true },
          include: {
            assignments: {
              where: { status: { in: ["PROJECTED_SEATED", "CONFIRMED_SEATED", "ASSIGNED"] } },
            },
          },
        },
        rsvps: {
          where: { signupRole: "BACKUP_DM", status: "GOING" },
          include: {
            participants: {
              where: {
                backupDmStatus: { in: ["BACKUP_AVAILABLE_AS_PLAYER", "BACKUP_ON_STANDBY"] },
              },
            },
          },
        },
      },
    });
    if (!event) throw new Error(`Event ${job.eventId} not found for backup DM ask job ${job.id}`);

    // Identify tracks that have waitlisted players but no DM table.
    const tablesByTrack = new Set(event.tables.map((t) => t.tableType));
    const seatedIds = new Set(
      event.participants.flatMap((p) => p.assignments.map((a) => a.eventParticipantId)),
    );
    const waitlistedByTrack = new Map<string, number>();
    for (const p of event.participants) {
      if (!seatedIds.has(p.id)) {
        const track = p.playerCategory ?? "MIXED";
        waitlistedByTrack.set(track, (waitlistedByTrack.get(track) ?? 0) + 1);
      }
    }

    const shortages = [...waitlistedByTrack.entries()].filter(
      ([track, count]) => count > 0 && !tablesByTrack.has(track as any),
    );

    if (shortages.length === 0) {
      this.logger.log(`Event ${job.eventId}: no DM shortage at T-3h, skipping backup DM ask`);
      return;
    }

    // Build a sorted candidate list with burnout data.
    const guildId = (event as any).guildId as string;
    const candidateUserIds = event.rsvps.flatMap((r) =>
      r.participants.map((p) => ({ discordUserId: r.primaryDiscordUserId, participantId: p.id })),
    );

    if (candidateUserIds.length === 0) {
      this.logger.warn(`Event ${job.eventId}: DM shortage but no available backup DM candidates`);
      return;
    }

    const ambassadors = await this.prisma.client.ambassadorProfile.findMany({
      where: { guildId, discordUserId: { in: candidateUserIds.map((c) => c.discordUserId) } },
    });
    const ambassadorByUser = new Map(ambassadors.map((a) => [a.discordUserId, a]));

    const sorted = [...candidateUserIds].sort((a, b) => {
      const aa = ambassadorByUser.get(a.discordUserId);
      const ba = ambassadorByUser.get(b.discordUserId);
      const aDate = aa?.lastDmDate?.getTime() ?? 0;
      const bDate = ba?.lastDmDate?.getTime() ?? 0;
      if (aDate !== bDate) return aDate - bDate;
      return (aa?.dmCountLast30Days ?? 0) - (ba?.dmCountLast30Days ?? 0);
    });

    const startTs = discordTs(event.startAt, "F");
    const shortageDesc = shortages.map(([track, count]) => `${track} (${count} waitlisted)`).join(", ");

    // Ask the top candidate.
    const top = sorted[0];
    const content =
      `📋 **Backup DM request — ${(event as any).title}**\n\n` +
      `Your help is needed to cover a DM shortage for **${shortageDesc}**.\n` +
      `Event time: ${startTs}\n\n` +
      `**If you accept, you will be moved from player to DM and your player seat will be released.**\n` +
      `Use the buttons below to respond.`;

    const components = [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 3,
            label: "Accept DM Assignment",
            custom_id: backupDmCustomId("accept", job.eventId, top.participantId),
          },
          {
            type: 2,
            style: 4,
            label: "Decline, Keep Player RSVP",
            custom_id: backupDmCustomId("decline", job.eventId, top.participantId),
          },
        ],
      },
    ];

    await discordDmPost(token, top.discordUserId, { content, components });
    this.logger.log(`Sent backup DM ask to ${top.discordUserId} for event ${job.eventId}`);
  }
}

// ─── Discord REST helpers ─────────────────────────────────────────────────

async function discordChannelPost(
  token: string,
  channelId: string,
  body: Record<string, unknown>,
) {
  await discordPost(token, `/channels/${channelId}/messages`, body);
}

async function discordDmPost(
  token: string,
  userId: string,
  body: Record<string, unknown>,
) {
  // Open (or reuse) a DM channel with this user.
  const dmChannel = await discordPost(token, "/users/@me/channels", {
    recipient_id: userId,
  }) as { id: string };
  await discordPost(token, `/channels/${dmChannel.id}/messages`, body);
}

async function discordPost(
  token: string,
  path: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    method: "POST",
    headers: {
      authorization: `Bot ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Discord API ${response.status} (${path}): ${text.slice(0, 500)}`);
  }

  return response.text().then((t) => (t ? JSON.parse(t) : {}));
}

function discordTs(date: Date, style: "F" | "R" | "t") {
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}

function buildSimpleContent(
  messageType: string,
  event: { title: string; startAt: Date; endAt: Date },
): string {
  const startTs = discordTs(event.startAt, "F");
  const endTs = discordTs(event.endAt, "t");
  switch (messageType) {
    case "PRE_EVENT":
      return `**${event.title}** starts ${startTs}! Check the event post for your table assignment.`;
    case "POST_EVENT":
      return `**${event.title}** has ended (${endTs}). Thanks for playing!`;
    default:
      return `Notification for **${event.title}** (${messageType}).`;
  }
}
