import { describe, expect, it } from "vitest";
import {
  ACTOR_ASSERTION_HEADER,
  buildMySignupView,
  parseActorDiscordId,
  type MySignupSource,
  type ParticipantSource,
} from "./my-signup.js";

const ACTOR = "100000000000000001";
const OTHER = "200000000000000002";
const NOW = new Date("2026-11-20T12:00:00.000Z");

type Source = MySignupSource;

function event(overrides: Partial<Source["event"]> = {}): Source["event"] {
  return {
    id: "evt1",
    title: "Game Night",
    status: "SIGNUP_OPEN",
    gameSystem: "D&D",
    startAt: "2026-11-21T23:00:00.000Z",
    endAt: "2026-11-22T03:00:00.000Z",
    signupOpensAt: null,
    signupClosesAt: null,
    assignmentLockedAt: null,
    eventType: { allowsGuests: true, maxGuestsPerRsvp: 3 },
    ...overrides,
  };
}

function primary(overrides: Record<string, unknown> = {}): ParticipantSource {
  return {
    id: `evt1:${ACTOR}:primary`,
    participantType: "PRIMARY",
    discordUserId: ACTOR,
    displayName: "Me",
    signupRole: "PLAYER",
    backupDmStatus: null,
    assignmentEligible: true,
    partyOwnerParticipantId: null,
    assignments: [],
    ...overrides,
  } as never;
}

function guest(
  id: string,
  name: string,
  overrides: Record<string, unknown> = {},
): ParticipantSource {
  return {
    id,
    participantType: "GUEST",
    discordUserId: null,
    displayName: name,
    signupRole: null,
    backupDmStatus: null,
    assignmentEligible: true,
    partyOwnerParticipantId: `evt1:${ACTOR}:primary`,
    assignments: [],
    ...overrides,
  } as never;
}

function rsvp(
  participants: ParticipantSource[],
  overrides: Record<string, unknown> = {},
): NonNullable<Source["rsvp"]> {
  return {
    primaryDiscordUserId: ACTOR,
    status: "GOING",
    signupRole: "PLAYER",
    selectedCategory: "NORMAL",
    participants,
    ...overrides,
  } as never;
}

const seatedAt = (status: string, createdAt = "2026-11-20T10:00:00.000Z") => ({
  status,
  createdAt,
  eventTable: {
    title: "Alice's Table",
    tableType: "NORMAL",
    ambassadorProfile: { displayName: "Alice" },
  },
});

const view = (source: Partial<Source>, actor = ACTOR) =>
  buildMySignupView(
    { event: event(), rsvp: null, tables: [], ...source },
    actor,
    NOW,
  );

describe("actor assertion", () => {
  it("uses an explicit internal header name", () => {
    expect(ACTOR_ASSERTION_HEADER).toBe("x-artemis-actor-discord-id");
  });

  it("accepts only Discord snowflakes", () => {
    expect(parseActorDiscordId(ACTOR)).toBe(ACTOR);
    for (const bad of [
      undefined,
      null,
      "",
      " ",
      "abc",
      "u1",
      "123",
      `${ACTOR}\n`,
      ` ${ACTOR}`,
      `${ACTOR},${OTHER}`,
      "1".repeat(30),
      ["1", "2"],
      Number.MAX_SAFE_INTEGER,
    ]) {
      expect(parseActorDiscordId(bad as never)).toBeNull();
    }
  });
});

describe("buildMySignupView: no registration", () => {
  it("offers Join and Run a table only", () => {
    const v = view({});
    expect(v.participation).toEqual({ state: "NONE", backup: "NONE" });
    expect(v.seat).toEqual({ code: "NONE" });
    expect(v.actions).toEqual({
      join: true,
      runTable: true,
      editTable: false,
      cancel: false,
      editGuests: false,
      editPreferences: false,
      addBackup: false,
    });
  });

  it("D&D events offer the legacy Normal/Heroic categories", () => {
    expect(view({}).event.categories).toEqual([
      { value: "NORMAL", label: "Normal" },
      { value: "HEROIC", label: "Heroic" },
    ]);
    expect(view({}).event.hostLabel).toBe("DM");
  });

  it("other systems offer one generic category and system host wording", () => {
    const v = view({ event: event({ gameSystem: "Daggerheart" }) });
    expect(v.event.categories).toEqual([{ value: "MIXED", label: "Open" }]);
    expect(v.event.hostLabel).toBe("GM");
  });

  it("a cancelled RSVP can rejoin; an organizer-removed one cannot", () => {
    expect(
      view({ rsvp: rsvp([primary()], { status: "CANCELLED" }) }).actions.join,
    ).toBe(true);
    const removed = view({ rsvp: rsvp([primary()], { status: "REMOVED" }) });
    expect(removed.participation.state).toBe("REMOVED");
    expect(removed.actions.join).toBe(false);
    expect(removed.actions.runTable).toBe(false);
  });

  it("an RSVP row owned by someone else is ignored", () => {
    const v = view({
      rsvp: rsvp([primary({ discordUserId: OTHER })], {
        primaryDiscordUserId: OTHER,
      }),
    });
    expect(v.participation.state).toBe("NONE");
    expect(JSON.stringify(v)).not.toContain(OTHER);
  });
});

describe("buildMySignupView: player", () => {
  it("registered player: status, guests and allowed actions; no seat promise", () => {
    const v = view({
      rsvp: rsvp([
        primary(),
        guest("g1", "Pat"),
        guest("g2", "Sam", { assignmentEligible: false }),
      ]),
    });
    expect(v.participation).toEqual({
      state: "PLAYER",
      category: "NORMAL",
      backup: "NONE",
    });
    expect(v.seat).toEqual({ code: "REGISTERED" });
    expect(v.guests).toEqual([
      { id: "g1", displayName: "Pat", seat: { code: "REGISTERED" } },
    ]);
    expect(v.event.maxGuests).toBe(3);
    expect(v.actions).toEqual({
      join: false,
      runTable: false,
      editTable: false,
      cancel: true,
      editGuests: true,
      editPreferences: true,
      addBackup: true,
    });
  });

  it("no guest editing when the event type disallows guests", () => {
    const v = view({
      event: event({ eventType: { allowsGuests: false, maxGuestsPerRsvp: 0 } }),
      rsvp: rsvp([primary()]),
    });
    expect(v.actions.editGuests).toBe(false);
  });

  it("player + backup: distinguishes availability and does not re-offer opt-in", () => {
    const v = view({
      rsvp: rsvp([primary({ backupDmStatus: "BACKUP_AVAILABLE_AS_PLAYER" })], {
        signupRole: "BACKUP_DM",
      }),
    });
    expect(v.participation.state).toBe("PLAYER");
    expect(v.participation.backup).toBe("AVAILABLE");
    expect(v.actions.addBackup).toBe(false);
    expect(v.actions.runTable).toBe(false);
  });

  it("a pending staffing pull is not disclosed (shown as plain availability)", () => {
    const v = view({
      rsvp: rsvp([primary({ backupDmStatus: "BACKUP_PULL_PENDING" })], {
        signupRole: "BACKUP_DM",
      }),
    });
    expect(v.participation.backup).toBe("AVAILABLE");
    expect(JSON.stringify(v)).not.toContain("PULL");
  });

  it("declined/released backup is not availability and can be re-opted explicitly", () => {
    for (const s of ["BACKUP_DECLINED_PULL", "BACKUP_RELEASED_AS_PLAYER"]) {
      const v = view({
        rsvp: rsvp([primary({ backupDmStatus: s })], {
          signupRole: "BACKUP_DM",
        }),
      });
      expect(v.participation.backup).toBe("NOT_AVAILABLE");
      expect(v.actions.addBackup).toBe(true);
    }
  });

  it("backup pulled to DM becomes an active GM without a player seat", () => {
    const v = view({
      rsvp: rsvp(
        [
          primary({
            backupDmStatus: "BACKUP_PULLED_TO_DM",
            assignments: [seatedAt("CONFIRMED_SEATED")],
          }),
        ],
        { signupRole: "BACKUP_DM" },
      ),
      event: event({ assignmentLockedAt: "2026-11-21T22:00:00.000Z" }),
    });
    expect(v.participation.state).toBe("GM");
    expect(v.seat).toEqual({ code: "NONE" });
    expect(v.actions.cancel).toBe(false);
    expect(v.actions.addBackup).toBe(false);
    expect(JSON.stringify(v)).not.toContain("Alice");
  });
});

describe("buildMySignupView: active GM", () => {
  const myTable = {
    id: "t1",
    title: "My Heroic Table",
    tableType: "HEROIC",
    softCap: 5,
    hardCap: 6,
    status: "OPEN",
    ambassadorProfile: { discordUserId: ACTOR, displayName: "Me" },
  };
  const otherTable = {
    id: "t2",
    title: "Zed's Table",
    tableType: "NORMAL",
    softCap: 6,
    hardCap: 7,
    status: "OPEN",
    ambassadorProfile: { discordUserId: OTHER, displayName: "Zed" },
  };

  it("sees GM role, only their own tables and table management; no Player+DM transition", () => {
    const v = view({ tables: [myTable, otherTable] });
    expect(v.participation).toEqual({ state: "GM", backup: "NONE" });
    expect(v.tables).toEqual([
      {
        id: "t1",
        title: "My Heroic Table",
        tableType: "HEROIC",
        softCap: 5,
        hardCap: 6,
      },
    ]);
    expect(v.actions).toEqual({
      join: false,
      runTable: false,
      editTable: true,
      cancel: false,
      editGuests: false,
      editPreferences: false,
      addBackup: false,
    });
    expect(JSON.stringify(v)).not.toContain("Zed");
  });

  it("cancelled/completed tables do not make the user a GM", () => {
    const v = view({
      tables: [
        { ...myTable, status: "CANCELLED" },
        { ...myTable, id: "t3", status: "COMPLETED" },
      ],
    });
    expect(v.participation.state).toBe("NONE");
    expect(v.tables).toEqual([]);
  });

  it("a TABLE_DM RSVP without a table is still a GM", () => {
    const v = view({
      rsvp: rsvp([primary({ signupRole: "TABLE_DM" })], {
        signupRole: "TABLE_DM",
      }),
    });
    expect(v.participation.state).toBe("GM");
    expect(v.actions.join).toBe(false);
  });

  it("table edits close once assignments lock", () => {
    const v = view({
      tables: [myTable],
      event: event({ assignmentLockedAt: "2026-11-21T22:00:00.000Z" }),
    });
    expect(v.actions.editTable).toBe(false);
  });
});

describe("buildMySignupView: seating copy states (no overpromise)", () => {
  it("does not invent a seat from a WAITLISTED registration without assignment rows", () => {
    const v = view({ rsvp: rsvp([primary()], { status: "WAITLISTED" }) });
    expect(v.seat.code).toBe("TENTATIVE_WAITLIST");
  });
  it("projected seat before lock is tentative and reveals no table", () => {
    const v = view({
      rsvp: rsvp([primary({ assignments: [seatedAt("PROJECTED_SEATED")] })]),
    });
    expect(v.seat).toEqual({ code: "TENTATIVE_SEAT" });
    expect(JSON.stringify(v)).not.toContain("Alice");
  });

  it("projected waitlist before lock is tentative", () => {
    const v = view({
      rsvp: rsvp([
        primary({
          assignments: [
            { ...seatedAt("PROJECTED_WAITLISTED"), eventTable: null },
          ],
        }),
      ]),
    });
    expect(v.seat).toEqual({ code: "TENTATIVE_WAITLIST" });
  });

  it("confirmed statuses without event lock are not trusted", () => {
    const v = view({
      rsvp: rsvp([primary({ assignments: [seatedAt("CONFIRMED_SEATED")] })]),
    });
    expect(v.seat).toEqual({ code: "TENTATIVE_SEAT" });
    expect(JSON.stringify(v)).not.toContain("Alice");
  });

  it("locked event with only projected rows stays tentative", () => {
    const v = view({
      event: event({ assignmentLockedAt: "2026-11-21T22:00:00.000Z" }),
      rsvp: rsvp([primary({ assignments: [seatedAt("PROJECTED_SEATED")] })]),
    });
    expect(v.seat).toEqual({ code: "TENTATIVE_SEAT" });
  });

  it("released confirmed seat shows own table and GM", () => {
    const v = view({
      event: event({ assignmentLockedAt: "2026-11-21T22:00:00.000Z" }),
      rsvp: rsvp([primary({ assignments: [seatedAt("CONFIRMED_SEATED")] })]),
    });
    expect(v.seat).toEqual({
      code: "CONFIRMED_SEAT",
      table: { title: "Alice's Table", tableType: "NORMAL", gmName: "Alice" },
    });
  });

  it("released confirmed waitlist is explicit and has no table", () => {
    const v = view({
      event: event({ assignmentLockedAt: "2026-11-21T22:00:00.000Z" }),
      rsvp: rsvp([
        primary({
          assignments: [
            { ...seatedAt("CONFIRMED_WAITLISTED"), eventTable: null },
          ],
        }),
      ]),
    });
    expect(v.seat).toEqual({ code: "CONFIRMED_WAITLIST" });
  });

  it("uses the newest live assignment and ignores removed rows", () => {
    const v = view({
      event: event({ assignmentLockedAt: "2026-11-21T22:00:00.000Z" }),
      rsvp: rsvp([
        primary({
          assignments: [
            seatedAt("REMOVED", "2026-11-20T12:00:00.000Z"),
            {
              ...seatedAt("CONFIRMED_WAITLISTED", "2026-11-20T09:00:00.000Z"),
              eventTable: null,
            },
            seatedAt("CONFIRMED_SEATED", "2026-11-20T11:00:00.000Z"),
          ],
        }),
      ]),
    });
    expect(v.seat.code).toBe("CONFIRMED_SEAT");
  });

  it("own guests get their own seat state, no guest identity leaks", () => {
    const v = view({
      event: event({ assignmentLockedAt: "2026-11-21T22:00:00.000Z" }),
      rsvp: rsvp([
        primary({ assignments: [seatedAt("CONFIRMED_SEATED")] }),
        guest("g1", "Pat", {
          discordUserId: "300000000000000003",
          assignments: [
            { ...seatedAt("CONFIRMED_WAITLISTED"), eventTable: null },
          ],
        }),
      ]),
    });
    expect(v.guests).toEqual([
      { id: "g1", displayName: "Pat", seat: { code: "CONFIRMED_WAITLIST" } },
    ]);
    expect(JSON.stringify(v)).not.toContain("300000000000000003");
  });
});

describe("buildMySignupView: lifecycle restrictions", () => {
  const registered = rsvp([primary()]);

  it.each(["CANCELLED", "COMPLETED", "ARCHIVED"])(
    "%s events disable every action",
    (status) => {
      const v = view({ event: event({ status }), rsvp: registered });
      expect(Object.values(v.actions).every((a) => a === false)).toBe(true);
      expect(v.event.closedReason).toBe(
        status === "CANCELLED" ? "CANCELLED" : "ENDED",
      );
      const none = view({ event: event({ status }) });
      expect(Object.values(none.actions).every((a) => a === false)).toBe(true);
    },
  );

  it("in-progress events are read-only", () => {
    const v = view({
      event: event({ status: "IN_PROGRESS" }),
      rsvp: registered,
    });
    expect(Object.values(v.actions).every((a) => a === false)).toBe(true);
    expect(v.event.closedReason).toBe("IN_PROGRESS");
  });

  it("locked assignments: no join, table, guest, preference or backup changes; cancel stays", () => {
    const locked = event({ assignmentLockedAt: "2026-11-21T22:00:00.000Z" });
    const v = view({ event: locked, rsvp: registered });
    expect(v.event.closedReason).toBe("LOCKED");
    expect(v.actions).toEqual({
      join: false,
      runTable: false,
      editTable: false,
      cancel: true,
      editGuests: false,
      editPreferences: false,
      addBackup: false,
    });
    const none = view({ event: locked });
    expect(none.actions.join).toBe(false);
    expect(none.actions.runTable).toBe(false);
  });

  it("LOCKED / SIGNUP_CLOSED statuses behave as closed", () => {
    for (const status of ["LOCKED", "SIGNUP_CLOSED"]) {
      const v = view({ event: event({ status }) });
      expect(v.actions.join).toBe(false);
      expect(v.event.closedReason).toBe(
        status === "LOCKED" ? "LOCKED" : "SIGNUP_CLOSED",
      );
    }
  });

  it("registration window gates join and table", () => {
    const early = view({
      event: event({ signupOpensAt: "2026-11-25T00:00:00.000Z" }),
    });
    expect(early.actions.join).toBe(false);
    expect(early.event.closedReason).toBe("NOT_OPEN_YET");
    const late = view({
      event: event({ signupClosesAt: "2026-11-19T00:00:00.000Z" }),
    });
    expect(late.actions.join).toBe(false);
    expect(late.actions.runTable).toBe(false);
    expect(late.event.closedReason).toBe("SIGNUP_CLOSED");
  });

  it("closed window still lets a registered player cancel but not edit", () => {
    const v = view({
      event: event({ signupClosesAt: "2026-11-19T00:00:00.000Z" }),
      rsvp: registered,
    });
    expect(v.actions.cancel).toBe(true);
    expect(v.actions.editGuests).toBe(false);
    expect(v.actions.addBackup).toBe(false);
  });
});

describe("buildMySignupView: privacy (real sanitization, hostile input)", () => {
  it("returns only the whitelisted keys and nothing about anyone else", () => {
    const hostileOwner = "300000000000000003";
    const source = {
      event: {
        ...event(),
        // extra properties a careless caller might pass through from Prisma
        createdByDiscordId: "organizer-secret-id",
        auditLogs: [{ action: "secret.audit" }],
        messageJobs: [{ lastError: "boom" }],
        eligibilityRules: [{ allowedDiscordRoleIds: ["role-secret"] }],
      },
      rsvp: {
        ...rsvp([
          primary({
            preferences: [
              { targetUserId: OTHER, preferenceType: "AVOID_PLAYER" },
            ],
          }),
          guest("g1", "Pat"),
          // someone else's guest and someone else's primary sneaking in
          guest("g9", "Stranger Guest", {
            partyOwnerParticipantId: `evt1:${OTHER}:primary`,
          }),
          primary({
            id: `evt1:${OTHER}:primary`,
            discordUserId: OTHER,
            displayName: "Other Player",
            assignments: [seatedAt("CONFIRMED_SEATED")],
          }),
        ]),
        signupPreferences: [{ targetUserId: OTHER }],
        notes: "organizer note",
      },
      tables: [
        {
          id: "t2",
          title: "Zed's Table",
          tableType: "NORMAL",
          softCap: 6,
          hardCap: 7,
          status: "OPEN",
          ambassadorProfile: { discordUserId: OTHER, displayName: "Zed" },
          assignments: [{ eventParticipantId: "x" }],
        },
      ],
      roster: [{ displayName: "Roster Person", discordUserId: hostileOwner }],
    } as unknown as Source;

    const v = buildMySignupView(source, ACTOR, NOW);
    const json = JSON.stringify(v);

    expect(Object.keys(v).sort()).toEqual(
      [
        "actions",
        "event",
        "eventId",
        "guests",
        "participation",
        "seat",
        "tables",
      ].sort(),
    );
    expect(Object.keys(v.event).sort()).toEqual(
      [
        "allowsGuests",
        "categories",
        "closedReason",
        "hostLabel",
        "maxGuests",
        "startAt",
        "status",
        "title",
        "usesDndCategories",
      ].sort(),
    );
    expect(v.guests.map((g) => g.id)).toEqual(["g1"]);
    for (const leaked of [
      OTHER,
      hostileOwner,
      "Other Player",
      "Stranger Guest",
      "Roster Person",
      "Zed",
      "organizer-secret-id",
      "secret.audit",
      "boom",
      "role-secret",
      "AVOID_PLAYER",
      "organizer note",
      "Alice",
      ACTOR, // the actor's own id is never echoed back either
    ]) {
      expect(json).not.toContain(leaked);
    }
  });
});
