// Framework-neutral presentation contracts for the public Discord event post
// and the organizer web UI. No discord.js / Discord REST / Node dependency:
// adapters (bot builders, API REST payloads, web labels) map these descriptors
// onto their own runtime. Public controls use the P01b IDs; the bot also keeps
// routing legacy IDs for posts already published before this slice.

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
  assignmentLockedAt?: Date | string | null;
  startAt: Date | string;
  endAt: Date | string;
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
    ],
  };
  if (event.imageUrl) embed.image = { url: event.imageUrl };
  return embed;
}

// Public post controls: Join, Run a table, My signup. Everything else
// (category choice, guests, preferences, backup availability, cancel) lives in
// the ephemeral personal panel opened by these buttons. Terminal events return
// no rows so stale buttons are not clickable; closed/locked events keep only
// My signup. Legacy `rsvp:`/`guest:`/`host:`/`assignment:`/`backup_dm:`/
// `cancel_rsvp:`/`prefs:` IDs on already-posted messages keep routing in the
// bot (see apps/bot/src/custom-ids.ts) but are no longer generated here.
const NO_CONTROL_STATUSES = ["CANCELLED", "COMPLETED", "ARCHIVED", "DRAFT"];
const VIEW_ONLY_STATUSES = ["LOCKED", "SIGNUP_CLOSED", "IN_PROGRESS"];

export function buildEventButtonRows(
  event: Pick<
    EventPresentationInput,
    "id" | "status" | "assignmentLockedAt" | "gameSystem" | "eventType"
  >,
): EventButtonDescriptor[][] {
  if (event.status && NO_CONTROL_STATUSES.includes(event.status)) return [];

  const mySignup: EventButtonDescriptor = {
    customId: `my_signup:${event.id}`,
    label: "My signup",
    style: 2,
  };
  if (
    event.assignmentLockedAt ||
    (event.status && VIEW_ONLY_STATUSES.includes(event.status))
  ) {
    return [[mySignup]];
  }

  return [
    [
      { customId: `join:${event.id}`, label: "Join", style: 3 },
      { customId: `run_table:${event.id}`, label: "Run a table", style: 1 },
      mySignup,
    ],
  ];
}
