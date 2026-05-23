import { z } from "zod";

const emptyStringToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;
const trimmedOptionalString = (maxLength: number) =>
  z.preprocess(
    emptyStringToUndefined,
    z.string().trim().max(maxLength).optional(),
  );
const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp)$/i;
const optionalImageUrlString = z.preprocess(emptyStringToUndefined, z
  .string()
  .trim()
  .url()
  .max(2048)
  .refine(
    (url) => url.startsWith("https://"),
    "Image URL must use https://.",
  )
  .refine((url) => {
    try {
      return IMAGE_EXTENSIONS.test(new URL(url).pathname);
    } catch {
      return false;
    }
  }, "Image URL must end in .png, .jpg, .jpeg, .gif, or .webp.")
  .optional());

const eventDateSchema = z.preprocess(
  (value) => {
    if (value instanceof Date) return value;
    if (typeof value !== "string") return value;

    const trimmed = value.trim();
    if (!trimmed) return undefined;

    // Prevent common Discord slash-command mistakes like "1700" from being
    // accepted by JavaScript as year 1700.
    if (
      /^\d{1,4}$/.test(trimmed) ||
      /^\d{1,2}:?\d{2}\s*(am|pm)?$/i.test(trimmed)
    ) {
      return new Date(Number.NaN);
    }

    return new Date(trimmed);
  },
  z.date({ error: "Use a full valid event date and time." }),
);

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
  "ARCHIVED",
]);
export type EventStatus = z.infer<typeof eventStatusSchema>;

export const participantTypeSchema = z.enum(["PRIMARY", "GUEST", "WALK_IN"]);
export type ParticipantType = z.infer<typeof participantTypeSchema>;

export const attendanceStatusSchema = z.enum([
  "ATTENDED",
  "NO_SHOW",
  "WALK_IN",
  "EXCUSED",
  "UNKNOWN",
]);
export type AttendanceStatus = z.infer<typeof attendanceStatusSchema>;

export const signupRoleSchema = z.enum([
  "PLAYER",
  "TABLE_DM",
  "BACKUP_DM",
  "AMBASSADOR",
]);
export type SignupRole = z.infer<typeof signupRoleSchema>;

export const eventCreateSchema = z.object({
  guildId: z.string().min(1),
  channelId: z.string().min(1),
  title: z.string().trim().min(1).max(120),
  description: trimmedOptionalString(2000),
  imageUrl: optionalImageUrlString,
  eventTypeKey: z.string().trim().min(1).default("dnd_session_night"),
  gameSystem: z.string().trim().min(1).default("D&D"),
  startAt: eventDateSchema,
  endAt: eventDateSchema,
  signupOpensAt: eventDateSchema.optional(),
  signupClosesAt: eventDateSchema.optional(),
  createdByDiscordId: z.string().min(1),
  seriesId: z.string().optional(),
});
export type EventCreateInput = z.infer<typeof eventCreateSchema>;

export const DEFAULT_EVENT_TIME_ZONE = "America/New_York";

export class EventDateTimeInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventDateTimeInputError";
  }
}

export function parseEventDateTimeParts(
  dateInput: string,
  timeInput: string,
  timeZone: string = DEFAULT_EVENT_TIME_ZONE,
): Date {
  const date = parseEventDateInput(dateInput);
  const time = parseEventTimeInput(timeInput);
  return zonedDateTimeToUtc({ ...date, ...time }, timeZone);
}

function parseEventDateInput(input: string) {
  const value = input.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  const [, yearText, monthText, dayText] = iso ?? [];
  const year = iso ? Number(yearText) : slash ? Number(slash[3]) : Number.NaN;
  const month = iso ? Number(monthText) : slash ? Number(slash[1]) : Number.NaN;
  const day = iso ? Number(dayText) : slash ? Number(slash[2]) : Number.NaN;

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    throw new EventDateTimeInputError(
      "Use a date like 2026-06-18 or 6/18/2026.",
    );
  }

  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new EventDateTimeInputError("That date is not valid.");
  }

  return { year, month, day };
}

function parseEventTimeInput(input: string) {
  const value = input.trim().toLowerCase();
  const clock24 = /^([01]?\d|2[0-3]):?([0-5]\d)$/.exec(value);
  const clock12 = /^(\d{1,2})(?::([0-5]\d))?\s*(am|pm)$/.exec(value);

  if (clock24) {
    return { hour: Number(clock24[1]), minute: Number(clock24[2]) };
  }

  if (clock12) {
    const rawHour = Number(clock12[1]);
    if (rawHour < 1 || rawHour > 12)
      throw new EventDateTimeInputError("That time is not valid.");
    const minute = Number(clock12[2] ?? "0");
    const hour = clock12[3] === "pm" ? (rawHour % 12) + 12 : rawHour % 12;
    return { hour, minute };
  }

  throw new EventDateTimeInputError("Use a time like 18:00, 6:00 PM, or 1700.");
}

function zonedDateTimeToUtc(
  parts: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
  },
  timeZone: string,
) {
  const desired = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
  );
  let utc = desired;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = formatUtcAsTimeZoneParts(new Date(utc), timeZone);
    const actualUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
    );
    const delta = desired - actualUtc;
    if (delta === 0) break;
    utc += delta;
  }

  const result = new Date(utc);
  const check = formatUtcAsTimeZoneParts(result, timeZone);
  if (
    check.year !== parts.year ||
    check.month !== parts.month ||
    check.day !== parts.day ||
    check.hour !== parts.hour ||
    check.minute !== parts.minute
  ) {
    throw new EventDateTimeInputError(
      "That local date and time is not valid in the configured timezone.",
    );
  }

  return result;
}

function formatUtcAsTimeZoneParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

export const eventUpdateSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  imageUrl: z.preprocess(
    emptyStringToUndefined,
    z
      .string()
      .trim()
      .url()
      .max(2048)
      .refine(
        (url) => url.startsWith("https://"),
        "Image URL must use https://.",
      )
      .refine((url) => {
        try {
          return IMAGE_EXTENSIONS.test(new URL(url).pathname);
        } catch {
          return false;
        }
      }, "Image URL must end in .png, .jpg, .jpeg, .gif, or .webp.")
      .nullable()
      .optional(),
  ),
  gameSystem: z.string().trim().min(1).optional(),
  startAt: eventDateSchema.optional(),
  endAt: eventDateSchema.optional(),
  actorDiscordId: z.string().min(1),
  applyToFuture: z.boolean().optional(),
});
export type EventUpdateInput = z.infer<typeof eventUpdateSchema>;

// ─── Event series schemas ─────────────────────────────────────────────────

const weekdaySchema = z.enum(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]);

export const eventSeriesCreateSchema = z.object({
  guildId: z.string().min(1),
  eventTypeKey: z.string().trim().min(1).default("dnd_session_night"),
  name: z.string().trim().min(1).max(120),
  defaultChannelId: z.string().min(1),
  recurrenceRule: z
    .string()
    .regex(/^WEEKLY:(MON|TUE|WED|THU|FRI|SAT|SUN)$/, "Only WEEKLY:<DAY> is supported, e.g. WEEKLY:FRI"),
  signupOpenHoursBefore: z.number().int().min(1).default(168),
  signupCloseHoursBefore: z.number().int().min(0).default(1),
  defaultRoleCleanupDays: z.number().int().min(1).default(7),
  defaultTitle: z.string().trim().min(1).max(120).optional(),
  defaultGameSystem: z.string().trim().min(1).default("D&D"),
  defaultDescription: trimmedOptionalString(2000),
  defaultImageUrl: optionalImageUrlString,
  defaultStartHour: z.number().int().min(0).max(23).default(18),
  defaultStartMinute: z.number().int().min(0).max(59).default(0),
  defaultDurationMinutes: z.number().int().min(30).max(720).default(240),
  createdByDiscordId: z.string().min(1),
});
export type EventSeriesCreateInput = z.infer<typeof eventSeriesCreateSchema>;

export const seriesGenerateSchema = z.object({
  count: z.coerce.number().int().min(1).max(12).default(4),
});
export type SeriesGenerateInput = z.infer<typeof seriesGenerateSchema>;

export const WEEKDAY_TO_JS: Record<string, number> = {
  SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6,
};

export function nextWeekdayDate(from: Date, targetDay: number): Date {
  const date = new Date(from);
  const current = date.getDay();
  const daysAhead = ((targetDay - current + 7) % 7) || 7;
  date.setDate(date.getDate() + daysAhead);
  return date;
}

/**
 * Timezone-aware version of nextWeekdayDate.
 * Finds the next calendar occurrence of targetDay (0=Sun…6=Sat) after `from`,
 * computing the current day-of-week in `tz` rather than server-local time.
 * Uses pure ms arithmetic (avoids setDate() local-time ambiguity near midnight).
 */
export function nextWeekdayDateInTimezone(from: Date, targetDay: number, tz: string): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  }).formatToParts(from);
  const weekdayName = parts.find((p) => p.type === "weekday")!.value;
  const JS_DAY: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const current = JS_DAY[weekdayName] ?? 0;
  const daysAhead = ((targetDay - current + 7) % 7) || 7;
  return new Date(from.getTime() + daysAhead * 24 * 60 * 60 * 1000);
}

/**
 * Create a Date representing a specific wall-clock time in the given IANA timezone.
 * DST-safe: uses a two-pass offset correction so spring/fall transitions are handled correctly.
 *
 * Example: makeDateInTimezone(2026, 3, 8, 18, 0, "America/New_York") returns the UTC
 * instant corresponding to 6:00 PM Eastern on March 8, 2026 (which is in EST, UTC-5).
 */
export function makeDateInTimezone(
  year: number,
  month: number, // 1-based
  day: number,
  hour: number,
  minute: number,
  tz: string,
): Date {
  // Step 1: treat the target local time as UTC to get a rough approximation
  const approxUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));

  // Step 2: ask Intl what local time that UTC instant shows in the target timezone
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  });
  const getPart = (type: string) =>
    parseInt(fmt.formatToParts(approxUtc).find((p) => p.type === type)!.value, 10);

  const tzYear = getPart("year");
  const tzMonth = getPart("month");
  const tzDay = getPart("day");
  const tzHour = getPart("hour");
  const tzMinute = getPart("minute");

  // Step 3: compute the difference between what we wanted and what the TZ shows
  const wantedUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  const tzShowsAsUtcMs = Date.UTC(tzYear, tzMonth - 1, tzDay, tzHour, tzMinute, 0);
  const offsetMs = wantedUtcMs - tzShowsAsUtcMs;

  return new Date(approxUtc.getTime() + offsetMs);
}

export const rsvpCreateSchema = z.object({
  discordUserId: z.string().min(1),
  displayName: z.string().trim().min(1).max(120),
  selectedCategory: playerCategorySchema.default("NORMAL"),
  signupRole: signupRoleSchema.default("PLAYER"),
  source: z.string().min(1).default("discord"),
});
export type RsvpCreateInput = z.infer<typeof rsvpCreateSchema>;

export const guestUpdateSchema = z.object({
  discordUserId: z.string().min(1),
  guests: z
    .array(
      z.object({
        displayName: z.string().trim().min(1).max(120),
        discordUserId: z.string().min(1).optional(),
      }),
    )
    .max(20),
});
export type GuestUpdateInput = z.infer<typeof guestUpdateSchema>;

export const tableCreateSchema = z
  .object({
    ambassadorDiscordId: z.string().min(1),
    ambassadorDisplayName: trimmedOptionalString(120),
    title: trimmedOptionalString(120),
    tableType: playerCategorySchema.default("MIXED"),
    softCap: z.coerce.number().int().min(1).max(20).default(6),
    hardCap: z.coerce.number().int().min(1).max(20).default(7),
    description: trimmedOptionalString(1000),
  })
  .superRefine((input, context) => {
    if (input.hardCap < input.softCap) {
      context.addIssue({
        code: "custom",
        path: ["hardCap"],
        message: "hardCap must be greater than or equal to softCap",
      });
    }
  });
export type TableCreateInput = z.infer<typeof tableCreateSchema>;

// ─── Eligibility rule schema ───────────────────────────────────────────────

export const eligibilityRuleSchema = z.object({
  eventId: z.string().min(1),
  signupRole: signupRoleSchema,
  allowedDiscordRoleIds: z.array(z.string().min(1)).default([]),
  requiredDiscordRoleIds: z.array(z.string().min(1)).default([]),
  deniedDiscordRoleIds: z.array(z.string().min(1)).default([]),
  requiresApproval: z.boolean().default(false),
});
export type EligibilityRuleInput = z.infer<typeof eligibilityRuleSchema>;

export type EligibilityCheckInput = {
  signupRole: SignupRole;
  memberDiscordRoleIds: string[];
};

export type EligibilityCheckResult =
  | { eligible: true }
  | { eligible: false; reason: string; requiresApproval?: boolean };

export function checkEligibility(
  rule: {
    allowedDiscordRoleIds: string[];
    requiredDiscordRoleIds: string[];
    deniedDiscordRoleIds: string[];
    requiresApproval: boolean;
  } | null,
  memberRoleIds: string[],
): EligibilityCheckResult {
  if (!rule) return { eligible: true };

  // Denied roles are always a hard block regardless of other roles.
  for (const denied of rule.deniedDiscordRoleIds) {
    if (memberRoleIds.includes(denied)) {
      return { eligible: false, reason: "You are not eligible for this signup option." };
    }
  }

  // Allowed: at least one of the allowed roles must be present (when any are configured).
  if (rule.allowedDiscordRoleIds.length > 0) {
    const hasAllowed = rule.allowedDiscordRoleIds.some((id) =>
      memberRoleIds.includes(id),
    );
    if (!hasAllowed) {
      return { eligible: false, reason: "You do not have the required role for this signup option." };
    }
  }

  // Required: every listed role must be present.
  for (const required of rule.requiredDiscordRoleIds) {
    if (!memberRoleIds.includes(required)) {
      return { eligible: false, reason: "You do not have the required role for this signup option." };
    }
  }

  if (rule.requiresApproval) {
    return { eligible: true, requiresApproval: true } as { eligible: true; requiresApproval: true };
  }

  return { eligible: true };
}

// ─── Assignment engine ────────────────────────────────────────────────────

// Reason codes recorded with every assignment decision.
export type AssignmentReasonCode =
  | "assigned_to_matching_table"
  | "waitlisted_no_matching_dm"
  | "waitlisted_no_capacity"
  | "waitlisted_track_mismatch"
  | "waitlisted_not_eligible"
  | "waitlisted_group_cannot_fit"
  | "waitlisted_conflict_constraint"
  | "needs_manual_approval"
  | "locked_assignment_preserved";

export type AssignmentParticipant = {
  id: string;
  displayName: string;
  partyKey: string;
  category: PlayerCategory;
  lockedTableId?: string | null;
  restrictions?: string[];
  // Avoid constraints are hard blocks
  avoidParticipantIds?: string[];
  avoidTableIds?: string[];
  // Soft scoring: preferred tables get first consideration
  preferredTableIds?: string[];
  // Seating group membership
  seatingGroupId?: string | null;
  seatingGroupSplitPolicy?: "DO_NOT_SPLIT" | "SPLIT_IF_NEEDED" | "ORGANIZER_DECIDES";
};

export type AssignmentTable = {
  id: string;
  title: string;
  tableType: PlayerCategory;
  softCap: number;
  hardCap: number;
  locked: boolean;
  // Only tables with a confirmed DM create capacity for player assignment.
  hasDm: boolean;
  existingParticipantIds: string[];
};

export type AssignmentWarning = {
  code:
    | "NO_TABLE"
    | "HARD_CAP"
    | "SOFT_CAP_EXCEEDED"
    | "LOCKED_ASSIGNMENT"
    | "CATEGORY_MISMATCH"
    | "PARTY_WAITLISTED"
    | "AVOID_CONSTRAINT_APPLIED"
    | "GROUP_SPLIT";
  message: string;
  participantIds?: string[];
  tableId?: string;
};

export type AssignmentDecision = {
  participantId: string;
  tableId: string | null;
  status: "ASSIGNED" | "WAITLISTED";
  reasonCode: AssignmentReasonCode;
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

// Hard rule: a player may only be assigned to a table whose type exactly
// matches the player's selected category. NORMAL → NORMAL only,
// HEROIC → HEROIC only, MIXED → MIXED only.
// This prevents the bug where a Normal player is seated at a Heroic DM's
// table (or vice versa) when no same-track table is available.
export function canParticipantUseTable(
  participant: AssignmentParticipant,
  table: AssignmentTable,
): boolean {
  return participant.category === table.tableType;
}

export function assignParticipantsToTables(
  participants: AssignmentParticipant[],
  tables: AssignmentTable[],
): AssignmentResult {
  const warnings: AssignmentWarning[] = [];
  const decisions: AssignmentDecision[] = [];
  const counts = new Map<string, number>();

  for (const table of tables) {
    counts.set(table.id, table.existingParticipantIds.length);
  }

  // Build a map of who is assigned to which table so far (for avoid-player checks).
  // This starts from locked/existing assignments and grows as we assign.
  const tableOccupants = new Map<string, Set<string>>();
  for (const table of tables) {
    tableOccupants.set(
      table.id,
      new Set(table.existingParticipantIds),
    );
  }

  const sortedParties = groupParties(participants).sort(
    (a, b) => b.participants.length - a.participants.length,
  );

  for (const party of sortedParties) {
    const lockedTableId = party.participants.find(
      (participant) => participant.lockedTableId,
    )?.lockedTableId;
    if (lockedTableId) {
      for (const participant of party.participants) {
        decisions.push({
          participantId: participant.id,
          tableId: lockedTableId,
          status: "ASSIGNED",
          reasonCode: "locked_assignment_preserved",
          reason: "Locked assignment preserved",
        });
        tableOccupants.get(lockedTableId)?.add(participant.id);
      }
      warnings.push({
        code: "LOCKED_ASSIGNMENT",
        message:
          "A locked assignment was preserved and excluded from balancing.",
        participantIds: party.participants.map((participant) => participant.id),
        tableId: lockedTableId,
      });
      continue;
    }

    // Collect all participant IDs in this party for avoid-participant checks.
    const partyIds = new Set(party.participants.map((p) => p.id));

    // Collect avoid constraints from all party members.
    const allAvoidParticipantIds = new Set(
      party.participants.flatMap((p) => p.avoidParticipantIds ?? []),
    );
    const allAvoidTableIds = new Set(
      party.participants.flatMap((p) => p.avoidTableIds ?? []),
    );

    // Tables this party prefers (soft — considered first in scoring).
    const anyPreferredTableIds = new Set(
      party.participants.flatMap((p) => p.preferredTableIds ?? []),
    );

    const eligible = tables
      .filter((table) => !table.locked)
      // Only tables with a confirmed DM are eligible for player assignment.
      .filter((table) => table.hasDm)
      // Track must match exactly.
      .filter((table) =>
        party.participants.every((participant) =>
          canParticipantUseTable(participant, table),
        ),
      )
      // Hard avoid-table constraint (DM avoid).
      .filter((table) => !allAvoidTableIds.has(table.id))
      .map((table) => {
        const current = counts.get(table.id) ?? 0;
        const occupants = tableOccupants.get(table.id) ?? new Set<string>();

        // Hard avoid-participant constraint: no one at this table may be in
        // the avoid list of any party member, and vice versa.
        const hasAvoidConflict =
          allAvoidParticipantIds.size > 0 &&
          [...occupants].some(
            (occupantId) =>
              !partyIds.has(occupantId) &&
              allAvoidParticipantIds.has(occupantId),
          );

        return {
          table,
          current,
          after: current + party.participants.length,
          softOverflow: Math.max(
            0,
            current + party.participants.length - table.softCap,
          ),
          isPreferred: anyPreferredTableIds.has(table.id),
          hasAvoidConflict,
        };
      })
      // Filter out tables with hard avoid-participant conflicts.
      .filter((candidate) => {
        if (candidate.hasAvoidConflict) {
          warnings.push({
            code: "AVOID_CONSTRAINT_APPLIED",
            message: "A table was excluded due to an avoid-participant constraint.",
            participantIds: party.participants.map((p) => p.id),
            tableId: candidate.table.id,
          });
          return false;
        }
        return true;
      })
      .filter((candidate) => candidate.after <= candidate.table.hardCap)
      .sort((a, b) => {
        // Preferred tables come first (soft scoring).
        if (a.isPreferred !== b.isPreferred) return a.isPreferred ? -1 : 1;
        if (a.softOverflow !== b.softOverflow)
          return a.softOverflow - b.softOverflow;
        if (a.current !== b.current) return a.current - b.current;
        return a.table.title.localeCompare(b.table.title);
      });

    const chosen = eligible[0];
    if (!chosen) {
      // Determine the most specific reason for waitlisting.
      const trackCompatible = tables.filter(
        (t) =>
          !t.locked &&
          party.participants.every((p) => canParticipantUseTable(p, t)),
      );
      const hasMatchingDm = trackCompatible.some((t) => t.hasDm);
      const hasCapacity = trackCompatible
        .filter((t) => t.hasDm)
        .some(
          (t) =>
            (counts.get(t.id) ?? 0) + party.participants.length <= t.hardCap,
        );

      let reasonCode: AssignmentReasonCode;
      let reason: string;

      if (trackCompatible.length === 0) {
        reasonCode = "waitlisted_track_mismatch";
        reason = `No table matches the selected track (${party.participants[0]?.category ?? "unknown"})`;
      } else if (!hasMatchingDm) {
        reasonCode = "waitlisted_no_matching_dm";
        reason = `No confirmed DM for the ${party.participants[0]?.category ?? "selected"} track`;
      } else if (!hasCapacity) {
        reasonCode = "waitlisted_no_capacity";
        reason = "All matching tables are at hard-cap capacity";
      } else {
        reasonCode = "waitlisted_conflict_constraint";
        reason = "No eligible table available due to conflict constraints";
      }

      for (const participant of party.participants) {
        decisions.push({
          participantId: participant.id,
          tableId: null,
          status: "WAITLISTED",
          reasonCode,
          reason,
        });
      }
      warnings.push({
        code: "PARTY_WAITLISTED",
        message: `Party waitlisted: ${reason}`,
        participantIds: party.participants.map((participant) => participant.id),
      });
      continue;
    }

    // Update tracking state for subsequent party assignments.
    counts.set(chosen.table.id, chosen.after);
    const occupants = tableOccupants.get(chosen.table.id) ?? new Set<string>();
    for (const p of party.participants) occupants.add(p.id);
    tableOccupants.set(chosen.table.id, occupants);

    if (chosen.after > chosen.table.softCap) {
      warnings.push({
        code: "SOFT_CAP_EXCEEDED",
        message: "A party was assigned above soft cap but within hard cap.",
        participantIds: party.participants.map((participant) => participant.id),
        tableId: chosen.table.id,
      });
    }

    for (const participant of party.participants) {
      decisions.push({
        participantId: participant.id,
        tableId: chosen.table.id,
        status: "ASSIGNED",
        reasonCode: "assigned_to_matching_table",
        reason:
          chosen.after <= chosen.table.softCap
            ? "Eligible table with the lowest current load under soft cap"
            : "Eligible table within hard cap after soft caps were exhausted",
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

  return [...parties.entries()].map(([key, grouped]) => ({
    key,
    participants: grouped,
  }));
}

const ianaTimezoneSchema = z
  .string()
  .min(1)
  .refine((tz) => {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Use a valid IANA timezone like America/New_York or America/Chicago.");

export const guildSettingsUpdateSchema = z.object({
  defaultTimezone: ianaTimezoneSchema.optional(),
  defaultEventChannelId: z
    .preprocess(emptyStringToUndefined, z.string().min(1).optional())
    .optional(),
  feedbackFormUrl: z.preprocess(
    emptyStringToUndefined,
    z.string().url().optional(),
  ),
  staffRoleIds: z.array(z.string().min(1)).optional(),
  adminRoleIds: z.array(z.string().min(1)).optional(),
  ambassadorRoleIds: z.array(z.string().min(1)).optional(),
  normalRoleIds: z.array(z.string().min(1)).optional(),
  heroicRoleIds: z.array(z.string().min(1)).optional(),
  temporaryRoleCleanupDays: z.number().int().min(1).max(90).optional(),
});
export type GuildSettingsUpdate = z.infer<typeof guildSettingsUpdateSchema>;

export const ambassadorCreateSchema = z.object({
  guildId: z.string().min(1),
  discordUserId: z.string().min(1),
  displayName: z.string().trim().min(1).max(120),
  supportedGameSystems: z.array(z.string().min(1)).default(["D&D"]),
  defaultSoftCap: z.number().int().min(1).max(20).default(6),
  defaultHardCap: z.number().int().min(2).max(25).default(7),
  defaultTableType: z.enum(["NORMAL", "HEROIC", "MIXED"]).default("MIXED"),
  notes: trimmedOptionalString(500),
});
export type AmbassadorCreateInput = z.infer<typeof ambassadorCreateSchema>;

export const ambassadorUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  supportedGameSystems: z.array(z.string().min(1)).optional(),
  defaultSoftCap: z.number().int().min(1).max(20).optional(),
  defaultHardCap: z.number().int().min(2).max(25).optional(),
  defaultTableType: z.enum(["NORMAL", "HEROIC", "MIXED"]).optional(),
  active: z.boolean().optional(),
  notes: trimmedOptionalString(500),
  dmCountLast30Days: z.number().int().min(0).optional(),
  backupPullCountLast90Days: z.number().int().min(0).optional(),
  lastDmDate: z.string().datetime().nullable().optional(),
});
export type AmbassadorUpdateInput = z.infer<typeof ambassadorUpdateSchema>;

export function temporaryRoleName(
  eventTitle: string,
  startAt: Date,
  roleType: "Players" | "Hosts",
  suffix?: string,
): string {
  const compactTitle = eventTitle
    .replace(/[^a-z0-9 ]/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 32);
  const date = startAt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
  const collisionSuffix = suffix ? ` ${suffix}` : "";
  return `Artemis ${compactTitle} ${date} ${roleType}${collisionSuffix}`.slice(
    0,
    100,
  );
}

// ─── Message job scheduling helpers ──────────────────────────────────────

// Default offsets for automatically scheduled messages.
export const MESSAGE_JOB_DEFAULTS = {
  preEventOffsetMs: 2 * 60 * 60 * 1000,      // 2 hours before startAt
  postEventOffsetMs: 60 * 60 * 1000,          // 1 hour after endAt
  reminderOffsetMs: 4 * 60 * 60 * 1000,       // 4 hours before startAt — organizer warning
  backupDmAskOffsetMs: 3 * 60 * 60 * 1000,   // 3 hours before startAt — backup DM consent ask
  // P0: assignment must lock exactly 1 hour before event start (rules.md §11.1).
  assignmentLockOffsetMs: 60 * 60 * 1000,     // 1 hour before startAt
} as const;

export function computePreEventScheduledFor(startAt: Date): Date {
  return new Date(startAt.getTime() - MESSAGE_JOB_DEFAULTS.preEventOffsetMs);
}

export function computePostEventScheduledFor(endAt: Date): Date {
  return new Date(endAt.getTime() + MESSAGE_JOB_DEFAULTS.postEventOffsetMs);
}

// T-4h: sends organizer a summary of projected seating, DM gaps, backup candidates.
export function computeReminderScheduledFor(startAt: Date): Date {
  return new Date(startAt.getTime() - MESSAGE_JOB_DEFAULTS.reminderOffsetMs);
}

// T-3h: checks for DM shortages and sends backup DM consent asks if needed.
export function computeBackupDmAskScheduledFor(startAt: Date): Date {
  return new Date(startAt.getTime() - MESSAGE_JOB_DEFAULTS.backupDmAskOffsetMs);
}

// T-1h: final assignment lock — this is a P0 requirement (rules.md §11.1).
export function computeAssignmentLockScheduledFor(startAt: Date): Date {
  return new Date(startAt.getTime() - MESSAGE_JOB_DEFAULTS.assignmentLockOffsetMs);
}

// ─── Backup DM Discord button helpers ────────────────────────────────────

// Canonical custom_id format for backup DM accept/decline buttons.
// Shared between the API (message sender) and the bot (interaction handler).
export function backupDmCustomId(
  action: "accept" | "decline",
  eventId: string,
  participantId: string,
): string {
  return `backupdm:${action}:${eventId}:${participantId}`;
}

export type ParsedBackupDmCustomId = {
  action: "accept" | "decline";
  eventId: string;
  participantId: string;
};

// Returns null when the customId does not match the backup DM format.
export function parseBackupDmCustomId(
  customId: string,
): ParsedBackupDmCustomId | null {
  const parts = customId.split(":");
  if (parts.length < 4 || parts[0] !== "backupdm") return null;
  const action = parts[1];
  if (action !== "accept" && action !== "decline") return null;
  // eventId and participantId may themselves contain colons (cuid2 does not,
  // but be defensive: rejoin everything after index 2 split at the last colon).
  const eventId = parts[2];
  const participantId = parts.slice(3).join(":");
  if (!eventId || !participantId) return null;
  return { action, eventId, participantId };
}
