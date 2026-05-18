import { z } from "zod";

export const playerCategorySchema = z.enum(["NORMAL", "HEROIC", "MIXED"]);
export type PlayerCategory = z.infer<typeof playerCategorySchema>;

export const eventStatusSchema = z.enum([
  "DRAFT",
  "SCHEDULED",
  "SIGNUP_OPEN",
  "SIGNUP_CLOSED",
  "LOCKED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "ARCHIVED"
]);
export type EventStatus = z.infer<typeof eventStatusSchema>;

export const participantTypeSchema = z.enum(["PRIMARY", "GUEST", "WALK_IN"]);
export type ParticipantType = z.infer<typeof participantTypeSchema>;

export const attendanceStatusSchema = z.enum(["ATTENDED", "NO_SHOW", "WALK_IN", "EXCUSED", "UNKNOWN"]);
export type AttendanceStatus = z.infer<typeof attendanceStatusSchema>;

export const eventCreateSchema = z.object({
  guildId: z.string().min(1),
  channelId: z.string().min(1),
  title: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  eventTypeKey: z.string().min(1).default("dnd_session_night"),
  gameSystem: z.string().min(1).default("D&D"),
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
  signupOpensAt: z.coerce.date().optional(),
  signupClosesAt: z.coerce.date().optional(),
  createdByDiscordId: z.string().min(1)
});
export type EventCreateInput = z.infer<typeof eventCreateSchema>;

export const rsvpCreateSchema = z.object({
  discordUserId: z.string().min(1),
  displayName: z.string().min(1).max(120),
  selectedCategory: playerCategorySchema.default("NORMAL"),
  source: z.string().min(1).default("discord")
});
export type RsvpCreateInput = z.infer<typeof rsvpCreateSchema>;

export const guestUpdateSchema = z.object({
  discordUserId: z.string().min(1),
  guests: z
    .array(
      z.object({
        displayName: z.string().min(1).max(120),
        discordUserId: z.string().min(1).optional()
      })
    )
    .max(3)
});
export type GuestUpdateInput = z.infer<typeof guestUpdateSchema>;

export const tableCreateSchema = z.object({
  ambassadorDiscordId: z.string().min(1),
  title: z.string().min(1).max(120).optional(),
  tableType: playerCategorySchema.default("MIXED"),
  softCap: z.number().int().min(1).max(20).default(6),
  hardCap: z.number().int().min(1).max(20).default(7),
  description: z.string().max(1000).optional()
});
export type TableCreateInput = z.infer<typeof tableCreateSchema>;

export type AssignmentParticipant = {
  id: string;
  displayName: string;
  partyKey: string;
  category: PlayerCategory;
  lockedTableId?: string | null;
  restrictions?: string[];
};

export type AssignmentTable = {
  id: string;
  title: string;
  tableType: PlayerCategory;
  softCap: number;
  hardCap: number;
  locked: boolean;
  existingParticipantIds: string[];
};

export type AssignmentWarning = {
  code:
    | "NO_TABLE"
    | "HARD_CAP"
    | "SOFT_CAP_EXCEEDED"
    | "LOCKED_ASSIGNMENT"
    | "CATEGORY_MISMATCH"
    | "PARTY_WAITLISTED";
  message: string;
  participantIds?: string[];
  tableId?: string;
};

export type AssignmentDecision = {
  participantId: string;
  tableId: string | null;
  status: "ASSIGNED" | "WAITLISTED";
  reason: string;
};

export type AssignmentResult = {
  decisions: AssignmentDecision[];
  warnings: AssignmentWarning[];
};

type Party = {
  key: string;
  participants: AssignmentParticipant[];
};

export function canParticipantUseTable(participant: AssignmentParticipant, table: AssignmentTable): boolean {
  if (participant.category === "NORMAL") {
    return table.tableType === "NORMAL" || table.tableType === "MIXED";
  }

  if (participant.category === "HEROIC") {
    return table.tableType === "HEROIC" || table.tableType === "NORMAL" || table.tableType === "MIXED";
  }

  return table.tableType === "MIXED" || table.tableType === "NORMAL" || table.tableType === "HEROIC";
}

export function assignParticipantsToTables(
  participants: AssignmentParticipant[],
  tables: AssignmentTable[]
): AssignmentResult {
  const warnings: AssignmentWarning[] = [];
  const decisions: AssignmentDecision[] = [];
  const counts = new Map<string, number>();

  for (const table of tables) {
    counts.set(table.id, table.existingParticipantIds.length);
  }

  const sortedParties = groupParties(participants).sort((a, b) => b.participants.length - a.participants.length);

  for (const party of sortedParties) {
    const lockedTableId = party.participants.find((participant) => participant.lockedTableId)?.lockedTableId;
    if (lockedTableId) {
      for (const participant of party.participants) {
        decisions.push({
          participantId: participant.id,
          tableId: lockedTableId,
          status: "ASSIGNED",
          reason: "Locked assignment preserved"
        });
      }
      warnings.push({
        code: "LOCKED_ASSIGNMENT",
        message: "A locked assignment was preserved and excluded from balancing.",
        participantIds: party.participants.map((participant) => participant.id),
        tableId: lockedTableId
      });
      continue;
    }

    const eligible = tables
      .filter((table) => !table.locked)
      .filter((table) => party.participants.every((participant) => canParticipantUseTable(participant, table)))
      .map((table) => {
        const current = counts.get(table.id) ?? 0;
        return {
          table,
          current,
          after: current + party.participants.length,
          softOverflow: Math.max(0, current + party.participants.length - table.softCap)
        };
      })
      .filter((candidate) => candidate.after <= candidate.table.hardCap)
      .sort((a, b) => {
        if (a.softOverflow !== b.softOverflow) return a.softOverflow - b.softOverflow;
        if (a.current !== b.current) return a.current - b.current;
        return a.table.title.localeCompare(b.table.title);
      });

    const chosen = eligible[0];
    if (!chosen) {
      for (const participant of party.participants) {
        decisions.push({
          participantId: participant.id,
          tableId: null,
          status: "WAITLISTED",
          reason: "No eligible table had enough hard-cap space for this party"
        });
      }
      warnings.push({
        code: "PARTY_WAITLISTED",
        message: "A party was waitlisted because no eligible table had enough hard-cap space.",
        participantIds: party.participants.map((participant) => participant.id)
      });
      continue;
    }

    counts.set(chosen.table.id, chosen.after);
    if (chosen.after > chosen.table.softCap) {
      warnings.push({
        code: "SOFT_CAP_EXCEEDED",
        message: "A party was assigned above soft cap but within hard cap.",
        participantIds: party.participants.map((participant) => participant.id),
        tableId: chosen.table.id
      });
    }

    for (const participant of party.participants) {
      decisions.push({
        participantId: participant.id,
        tableId: chosen.table.id,
        status: "ASSIGNED",
        reason:
          chosen.after <= chosen.table.softCap
            ? "Eligible table with the lowest current load under soft cap"
            : "Eligible table within hard cap after soft caps were exhausted"
      });
    }
  }

  return { decisions, warnings };
}

function groupParties(participants: AssignmentParticipant[]): Party[] {
  const parties = new Map<string, AssignmentParticipant[]>();
  for (const participant of participants) {
    const existing = parties.get(participant.partyKey) ?? [];
    existing.push(participant);
    parties.set(participant.partyKey, existing);
  }

  return [...parties.entries()].map(([key, grouped]) => ({ key, participants: grouped }));
}

export function temporaryRoleName(eventTitle: string, startAt: Date, roleType: "Players" | "Hosts", suffix?: string): string {
  const compactTitle = eventTitle
    .replace(/[^a-z0-9 ]/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 32);
  const date = startAt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
  const collisionSuffix = suffix ? ` ${suffix}` : "";
  return `Artemis ${compactTitle} ${date} ${roleType}${collisionSuffix}`.slice(0, 100);
}
