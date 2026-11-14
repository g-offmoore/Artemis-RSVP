// Framework-neutral presentation contracts for the public Discord event post
// and the organizer web UI. No discord.js / Discord REST / Node dependency:
// adapters (bot builders, API REST payloads, web labels) map these descriptors
// onto their own runtime. Custom IDs are the legacy IDs routed by the bot
// interaction handler and must not change here.

import { computeAssignmentLockScheduledFor } from "./assignment-lock-time.js";

export type EventVocabulary = {
  usesDndCategories: boolean;
  attendeePlural: string;
  hostSingular: string;
  hostPlural: string;
  hostButtonLabel: string;
};

const DND_VOCABULARY: EventVocabulary = {
  usesDndCategories: true,
  attendeePlural: "Players",
  hostSingular: "DM",
  hostPlural: "DMs",
  hostButtonLabel: "DM Signup",
};

const GM_VOCABULARY: EventVocabulary = {
  usesDndCategories: false,
  attendeePlural: "Attendees",
  hostSingular: "GM",
  hostPlural: "GMs",
  hostButtonLabel: "GM Signup",
};

const DEFAULT_VOCABULARY: EventVocabulary = {
  usesDndCategories: false,
  attendeePlural: "Attendees",
  hostSingular: "Ambassador",
  hostPlural: "Ambassadors",
  hostButtonLabel: "Ambassador Signup",
};

export function resolveEventVocabulary(
  gameSystem?: string | null,
): EventVocabulary {
  const value = gameSystem?.trim().toLowerCase() ?? "";
  if (value === "d&d" || value === "dnd" || value.includes("dungeons")) {
    return { ...DND_VOCABULARY };
  }
  if (value === "daggerheart") return { ...GM_VOCABULARY };
  return { ...DEFAULT_VOCABULARY };
}

// Numeric values equal Discord's ButtonStyle enum (Primary=1 ... Danger=4)
// so REST payloads can use them directly.
export type EventButtonStyle = 1 | 2 | 3 | 4;

export type EventButtonDescriptor = {
  customId: string;
  label: string;
  style: EventButtonStyle;
};

export type EventEmbedDescriptor = {
  title: string;
  description: string;
  image?: { url: string };
  fields: Array<{ name: string; value: string; inline?: boolean }>;
};

export type EventPresentationInput = {
  id: string;
  title: string;
  description?: string | null;
  imageUrl?: string | null;
  gameSystem?: string | null;
  status?: string | null;
  startAt: Date | string;
  endAt: Date | string;
  assignmentLockOffsetMinutes?: number;
  eventType?: { allowsGuests?: boolean } | null;
  tables?: Array<{
    status: string;
    softCap?: number | null;
    hardCap?: number | null;
  }> | null;
  participants?: Array<{
    participantType: string;
    assignmentEligible?: boolean;
  }> | null;
};

const INACTIVE_TABLE_STATUSES = ["CANCELLED", "COMPLETED"];

function activeTables(event: Pick<EventPresentationInput, "tables">) {
  return Array.isArray(event.tables)
    ? event.tables.filter(
        (table) => !INACTIVE_TABLE_STATUSES.includes(table.status),
      )
    : [];
}

function eventCounts(event: EventPresentationInput) {
  const participants = Array.isArray(event.participants)
    ? event.participants.filter((p) => p.assignmentEligible !== false)
    : [];
  return {
    players: participants.filter((p) => p.participantType === "PRIMARY").length,
    guests: participants.filter((p) => p.participantType === "GUEST").length,
    hosts: activeTables(event).length,
  };
}

function eventCapacity(event: EventPresentationInput) {
  const tables = activeTables(event);
  return {
    tables: tables.length,
    softCap: tables.reduce((sum, t) => sum + (t.softCap ?? 0), 0),
    hardCap: tables.reduce((sum, t) => sum + (t.hardCap ?? 0), 0),
  };
}

export function formatDiscordTimestamp(
  value: Date | string,
  style: "F" | "R" | "t",
): string {
  return `<t:${Math.floor(new Date(value).getTime() / 1000)}:${style}>`;
}

export function formatDiscordTimeRange(
  startAt: Date | string,
  endAt: Date | string,
): string {
  return `${formatDiscordTimestamp(startAt, "F")} to ${formatDiscordTimestamp(endAt, "t")}\n${formatDiscordTimestamp(startAt, "R")}`;
}

export function buildEventEmbed(
  event: EventPresentationInput,
): EventEmbedDescriptor {
  const counts = eventCounts(event);
  const capacity = eventCapacity(event);
  const vocabulary = resolveEventVocabulary(event.gameSystem);
  const embed: EventEmbedDescriptor = {
    title: event.title,
    description: event.description ?? "Store event",
    fields: [
      {
        name: "When",
        value: formatDiscordTimeRange(event.startAt, event.endAt),
      },
      {
        name: "Registered",
        value: `${vocabulary.attendeePlural}: ${counts.players}\nGuests: ${counts.guests}\n${vocabulary.hostPlural}: ${counts.hosts}`,
        inline: true,
      },
      {
        name: "Capacity",
        value: capacity.hardCap
          ? `${counts.players + counts.guests}/${capacity.hardCap} seats\n${capacity.tables} tables`
          : `No ${vocabulary.hostSingular.toLowerCase()} tables yet`,
        inline: true,
      },
      { name: "Status", value: event.status ?? "SCHEDULED", inline: true },
      { name: "Event ID", value: event.id, inline: true },
      {
        name: "Assignment lock",
        // Explicitly scheduled, not a claim about when an actual lock occurred.
        value: `Scheduled: ${formatDiscordTimestamp(
          computeAssignmentLockScheduledFor(
            new Date(event.startAt),
            event.assignmentLockOffsetMinutes,
          ),
          "F",
        )}`,
      },
    ],
  };
  if (event.imageUrl) embed.image = { url: event.imageUrl };
  return embed;
}

// Two rows. Cancelled events return no rows so stale buttons are not
// clickable. Custom IDs are the legacy `<action>:<eventId>[:<category>]`
// format handled by the bot; do not rename them.
export function buildEventButtonRows(
  event: Pick<
    EventPresentationInput,
    "id" | "gameSystem" | "status" | "eventType"
  >,
): EventButtonDescriptor[][] {
  if (event.status === "CANCELLED") return [];

  const vocabulary = resolveEventVocabulary(event.gameSystem);
  const row1: EventButtonDescriptor[] = vocabulary.usesDndCategories
    ? [
        {
          customId: `rsvp:${event.id}:NORMAL`,
          label: "RSVP Normal",
          style: 3,
        },
        {
          customId: `rsvp:${event.id}:HEROIC`,
          label: "RSVP Heroic",
          style: 1,
        },
      ]
    : [{ customId: `rsvp:${event.id}:MIXED`, label: "RSVP", style: 3 }];

  if (event.eventType?.allowsGuests !== false) {
    row1.push({ customId: `guest:${event.id}`, label: "Guests", style: 2 });
  }

  row1.push(
    {
      customId: `host:${event.id}`,
      label: vocabulary.hostButtonLabel,
      style: 2,
    },
    {
      customId: `assignment:${event.id}`,
      label: "My Assignment",
      style: 2,
    },
  );

  const row2: EventButtonDescriptor[] = [
    {
      customId: `backup_dm:${event.id}`,
      label: "Backup DM Signup",
      style: 1,
    },
    { customId: `cancel_rsvp:${event.id}`, label: "Cancel RSVP", style: 4 },
    { customId: `prefs:${event.id}`, label: "Preferences", style: 2 },
  ];

  return [row1, row2];
}
