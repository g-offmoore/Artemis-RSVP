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
});
export type EventUpdateInput = z.infer<typeof eventUpdateSchema>;

export const rsvpCreateSchema = z.object({
  discordUserId: z.string().min(1),
  displayName: z.string().trim().min(1).max(120),
  selectedCategory: playerCategorySchema.default("NORMAL"),
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

export function canParticipantUseTable(
  participant: AssignmentParticipant,
  table: AssignmentTable,
): boolean {
  if (participant.category === "NORMAL") {
    return table.tableType === "NORMAL" || table.tableType === "MIXED";
  }

  if (participant.category === "HEROIC") {
    return (
      table.tableType === "HEROIC" ||
      table.tableType === "NORMAL" ||
      table.tableType === "MIXED"
    );
  }

  return (
    table.tableType === "MIXED" ||
    table.tableType === "NORMAL" ||
    table.tableType === "HEROIC"
  );
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
          reason: "Locked assignment preserved",
        });
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

    const eligible = tables
      .filter((table) => !table.locked)
      .filter((table) =>
        party.participants.every((participant) =>
          canParticipantUseTable(participant, table),
        ),
      )
      .map((table) => {
        const current = counts.get(table.id) ?? 0;
        return {
          table,
          current,
          after: current + party.participants.length,
          softOverflow: Math.max(
            0,
            current + party.participants.length - table.softCap,
          ),
        };
      })
      .filter((candidate) => candidate.after <= candidate.table.hardCap)
      .sort((a, b) => {
        if (a.softOverflow !== b.softOverflow)
          return a.softOverflow - b.softOverflow;
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
          reason: "No eligible table had enough hard-cap space for this party",
        });
      }
      warnings.push({
        code: "PARTY_WAITLISTED",
        message:
          "A party was waitlisted because no eligible table had enough hard-cap space.",
        participantIds: party.participants.map((participant) => participant.id),
      });
      continue;
    }

    counts.set(chosen.table.id, chosen.after);
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
});
export type GuildSettingsUpdate = z.infer<typeof guildSettingsUpdateSchema>;

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
