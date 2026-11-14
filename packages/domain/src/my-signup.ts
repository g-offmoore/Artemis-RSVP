// Participant-safe "My signup" view (P01b).
//
// `buildMySignupView` is a PURE projection from event/registration rows onto a
// whitelist of fields that are safe to show ONE acting participant. It is the
// sanitization boundary: it re-checks ownership of every row it is handed, so a
// caller that loads too much (or a future query regression) still cannot leak
// other participants, preference targets, roster, audit or staffing data.
//
// The actor is an internal bot assertion, NOT user authentication. See
// docs/changes/P01b-personal-panel.md for the trust model.
import { resolveEventVocabulary } from "./event-presentation.js";

/** Internal-only header carrying the Discord user id the bot is acting for. */
export const ACTOR_ASSERTION_HEADER = "x-artemis-actor-discord-id";

// Discord snowflakes are 17-20 digit decimal strings today.
const SNOWFLAKE = /^\d{17,20}$/;

/** Returns the actor id when it is exactly one well-formed snowflake. */
export function parseActorDiscordId(value: unknown): string | null {
  return typeof value === "string" && SNOWFLAKE.test(value) ? value : null;
}

export type ClosedReason =
  | "CANCELLED"
  | "ENDED"
  | "IN_PROGRESS"
  | "NOT_PUBLISHED"
  | "LOCKED"
  | "SIGNUP_CLOSED"
  | "NOT_OPEN_YET";

export type SeatCode =
  | "NONE"
  | "REGISTERED"
  | "TENTATIVE_SEAT"
  | "TENTATIVE_WAITLIST"
  | "CONFIRMED_SEAT"
  | "CONFIRMED_WAITLIST";

export type SeatView = {
  code: SeatCode;
  /** Present only for a released (locked + confirmed) seat. */
  table?: { title: string; tableType: string; gmName?: string };
};

export type MySignupView = {
  eventId: string;
  event: {
    title: string;
    status: string;
    startAt: string;
    usesDndCategories: boolean;
    categories: Array<{ value: string; label: string }>;
    hostLabel: string;
    allowsGuests: boolean;
    maxGuests: number;
    closedReason: ClosedReason | null;
  };
  participation: {
    state: "NONE" | "CANCELLED" | "REMOVED" | "PLAYER" | "GM";
    category?: string;
    backup: "NONE" | "AVAILABLE" | "NOT_AVAILABLE";
  };
  seat: SeatView;
  guests: Array<{ id: string; displayName: string; seat: SeatView }>;
  tables: Array<{
    id: string;
    title: string;
    tableType: string;
    softCap: number;
    hardCap: number;
  }>;
  actions: {
    join: boolean;
    runTable: boolean;
    editTable: boolean;
    cancel: boolean;
    editGuests: boolean;
    editPreferences: boolean;
    addBackup: boolean;
  };
};

type DateLike = Date | string;

type AssignmentSource = {
  status: string;
  createdAt: DateLike;
  eventTable?: {
    title: string;
    tableType: string;
    ambassadorProfile?: { displayName: string } | null;
  } | null;
};

export type ParticipantSource = {
  id: string;
  participantType: string;
  discordUserId?: string | null;
  displayName: string;
  signupRole?: string | null;
  backupDmStatus?: string | null;
  assignmentEligible?: boolean;
  partyOwnerParticipantId?: string | null;
  assignments?: AssignmentSource[] | null;
};

export type MySignupSource = {
  event: {
    id: string;
    title: string;
    status: string;
    gameSystem: string;
    startAt: DateLike;
    endAt?: DateLike;
    signupOpensAt?: DateLike | null;
    signupClosesAt?: DateLike | null;
    assignmentLockedAt?: DateLike | null;
    eventType?: { allowsGuests?: boolean; maxGuestsPerRsvp?: number } | null;
  };
  rsvp:
    | {
        primaryDiscordUserId: string;
        status: string;
        signupRole: string;
        selectedCategory: string;
        participants?: ParticipantSource[] | null;
      }
    | null
    | undefined;
  tables?: Array<{
    id: string;
    title: string;
    tableType: string;
    softCap: number;
    hardCap: number;
    status: string;
    ambassadorProfile?: {
      discordUserId?: string | null;
      displayName?: string;
    } | null;
  }> | null;
};

const INACTIVE_TABLE = ["CANCELLED", "COMPLETED"];
const LIVE_ASSIGNMENT = [
  "ASSIGNED",
  "WAITLISTED",
  "PROJECTED_SEATED",
  "PROJECTED_WAITLISTED",
  "CONFIRMED_SEATED",
  "CONFIRMED_WAITLISTED",
];
const BACKUP_AVAILABLE = [
  "BACKUP_AVAILABLE_AS_PLAYER",
  "BACKUP_ON_STANDBY",
  // A pending pull is organizer-side staffing state; participants only see
  // plain availability.
  "BACKUP_PULL_PENDING",
];

function time(value: DateLike | null | undefined): number | null {
  return value ? new Date(value).getTime() : null;
}

function closedReasonFor(
  event: MySignupSource["event"],
  now: Date,
): ClosedReason | null {
  const status = event.status;
  if (status === "CANCELLED") return "CANCELLED";
  if (status === "COMPLETED" || status === "ARCHIVED") return "ENDED";
  if (status === "IN_PROGRESS") return "IN_PROGRESS";
  if (status === "DRAFT") return "NOT_PUBLISHED";
  if (event.assignmentLockedAt || status === "LOCKED") return "LOCKED";
  const closes = time(event.signupClosesAt);
  if (status === "SIGNUP_CLOSED" || (closes !== null && now.getTime() > closes))
    return "SIGNUP_CLOSED";
  const opens = time(event.signupOpensAt);
  if (opens !== null && now.getTime() < opens) return "NOT_OPEN_YET";
  return null;
}

function seatFor(participant: ParticipantSource, released: boolean): SeatView {
  const live = (participant.assignments ?? [])
    .filter((a) => LIVE_ASSIGNMENT.includes(a.status))
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  const latest = live[0];
  if (!latest) return { code: "REGISTERED" };

  if (latest.status === "CONFIRMED_SEATED") {
    if (!released) return { code: "TENTATIVE_SEAT" };
    const table = latest.eventTable;
    // Never claim a confirmed seat that has no table behind it.
    if (!table) return { code: "REGISTERED" };
    const gmName = table.ambassadorProfile?.displayName;
    return {
      code: "CONFIRMED_SEAT",
      table: {
        title: table.title,
        tableType: table.tableType,
        ...(gmName ? { gmName } : {}),
      },
    };
  }
  if (latest.status === "CONFIRMED_WAITLISTED") {
    return { code: released ? "CONFIRMED_WAITLIST" : "TENTATIVE_WAITLIST" };
  }
  if (
    latest.status === "PROJECTED_WAITLISTED" ||
    latest.status === "WAITLISTED"
  ) {
    return { code: "TENTATIVE_WAITLIST" };
  }
  // PROJECTED_SEATED and legacy ASSIGNED are never final.
  return { code: "TENTATIVE_SEAT" };
}

export function buildMySignupView(
  source: MySignupSource,
  actorDiscordId: string,
  now: Date = new Date(),
): MySignupView {
  const { event } = source;
  const vocabulary = resolveEventVocabulary(event.gameSystem);
  const closedReason = closedReasonFor(event, now);
  const released = Boolean(event.assignmentLockedAt);
  const windowOpen = closedReason === null;
  const terminal =
    closedReason === "CANCELLED" ||
    closedReason === "ENDED" ||
    closedReason === "IN_PROGRESS" ||
    closedReason === "NOT_PUBLISHED";
  const locked = closedReason === "LOCKED";

  // Ownership re-check: ignore any row that is not the actor's.
  const ownRsvp =
    source.rsvp && source.rsvp.primaryDiscordUserId === actorDiscordId
      ? source.rsvp
      : null;
  const participants = ownRsvp?.participants ?? [];
  const primary =
    participants.find(
      (p) =>
        p.participantType === "PRIMARY" && p.discordUserId === actorDiscordId,
    ) ?? null;
  const primaryId = primary?.id ?? `${event.id}:${actorDiscordId}:primary`;

  const ownTables = (source.tables ?? []).filter(
    (t) =>
      t.ambassadorProfile?.discordUserId === actorDiscordId &&
      !INACTIVE_TABLE.includes(t.status),
  );

  const activeRsvp =
    ownRsvp && (ownRsvp.status === "GOING" || ownRsvp.status === "WAITLISTED")
      ? ownRsvp
      : null;
  const isGm =
    ownTables.length > 0 ||
    (activeRsvp !== null &&
      (activeRsvp.signupRole === "TABLE_DM" ||
        primary?.backupDmStatus === "BACKUP_PULLED_TO_DM"));

  let state: MySignupView["participation"]["state"] = "NONE";
  if (isGm) state = "GM";
  else if (activeRsvp) state = "PLAYER";
  else if (ownRsvp?.status === "CANCELLED") state = "CANCELLED";
  else if (ownRsvp?.status === "REMOVED") state = "REMOVED";

  // Backup availability comes from the canonical RSVP role. A stale participant
  // backupDmStatus left over from an earlier backup opt-in is ignored.
  let backup: MySignupView["participation"]["backup"] = "NONE";
  if (activeRsvp && activeRsvp.signupRole === "BACKUP_DM") {
    backup =
      primary?.backupDmStatus &&
      !BACKUP_AVAILABLE.includes(primary.backupDmStatus)
        ? "NOT_AVAILABLE"
        : "AVAILABLE";
  }

  const allowsGuests = event.eventType?.allowsGuests !== false;
  const maxGuests = allowsGuests ? (event.eventType?.maxGuestsPerRsvp ?? 0) : 0;
  const isPlayer = state === "PLAYER";
  const restartable = state === "NONE" || state === "CANCELLED";

  const guests =
    isPlayer && ownRsvp
      ? participants
          .filter(
            (p) =>
              p.participantType === "GUEST" &&
              p.partyOwnerParticipantId === primaryId &&
              p.assignmentEligible !== false,
          )
          .map((p) => ({
            id: p.id,
            displayName: p.displayName,
            seat: seatFor(p, released),
          }))
      : [];

  return {
    eventId: event.id,
    event: {
      title: event.title,
      status: event.status,
      startAt: new Date(event.startAt).toISOString(),
      usesDndCategories: vocabulary.usesDndCategories,
      categories: vocabulary.usesDndCategories
        ? [
            { value: "NORMAL", label: "Normal" },
            { value: "HEROIC", label: "Heroic" },
          ]
        : [{ value: "MIXED", label: "Open" }],
      hostLabel: vocabulary.hostSingular,
      allowsGuests,
      maxGuests,
      closedReason,
    },
    participation: {
      state,
      ...(isPlayer && ownRsvp ? { category: ownRsvp.selectedCategory } : {}),
      backup,
    },
    seat:
      isPlayer && primary
        ? ownRsvp?.status === "WAITLISTED"
          ? { code: "TENTATIVE_WAITLIST" }
          : seatFor(primary, released)
        : { code: "NONE" },
    guests,
    tables: ownTables.map((t) => ({
      id: t.id,
      title: t.title,
      tableType: t.tableType,
      softCap: t.softCap,
      hardCap: t.hardCap,
    })),
    actions: {
      join: windowOpen && restartable,
      runTable: windowOpen && restartable,
      editTable: windowOpen && state === "GM" && ownTables.length > 0,
      // No supported actor-scoped path cancels a GM table yet (organizer-only),
      // so a GM is never offered Cancel here.
      cancel: isPlayer && !terminal,
      editGuests: isPlayer && windowOpen && allowsGuests && maxGuests > 0,
      editPreferences: isPlayer && !terminal && !locked,
      addBackup: isPlayer && windowOpen && backup !== "AVAILABLE",
    },
  };
}
