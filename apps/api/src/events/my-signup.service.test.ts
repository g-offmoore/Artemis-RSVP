import { describe, expect, it } from "vitest";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { EventsService } from "./events.service.js";

// In-memory Prisma stand-in that actually evaluates the few `where` clauses
// getMySignup uses, so the test proves the QUERIES are actor-scoped and the
// output is sanitized -- not just that a mock returned canned data.

const ACTOR = "100000000000000001";
const OTHER = "200000000000000002";
const THIRD = "300000000000000003";

const event = {
  id: "evt1",
  guildId: "g1",
  title: "Game Night",
  status: "SIGNUP_OPEN",
  gameSystem: "D&D",
  startAt: new Date("2026-12-01T23:00:00.000Z"),
  endAt: new Date("2026-12-02T03:00:00.000Z"),
  signupOpensAt: null,
  signupClosesAt: null,
  assignmentLockedAt: new Date("2026-12-01T22:00:00.000Z"),
  createdByDiscordId: "organizer-secret",
  eventType: { allowsGuests: true, maxGuestsPerRsvp: 3 },
};

const aliceTable = {
  id: "t1",
  eventId: "evt1",
  title: "Alice's Table",
  tableType: "NORMAL",
  softCap: 5,
  hardCap: 6,
  status: "OPEN",
  ambassadorProfile: { discordUserId: THIRD, displayName: "Alice" },
};
const zedTable = {
  ...aliceTable,
  id: "t2",
  title: "Zed's Table",
  ambassadorProfile: { discordUserId: OTHER, displayName: "Zed" },
};

const participants = [
  {
    id: `evt1:${ACTOR}:primary`,
    eventId: "evt1",
    rsvpId: "r-me",
    participantType: "PRIMARY",
    discordUserId: ACTOR,
    displayName: "Me",
    signupRole: "PLAYER",
    backupDmStatus: null,
    assignmentEligible: true,
    partyOwnerParticipantId: null,
    assignments: [
      {
        status: "CONFIRMED_SEATED",
        createdAt: new Date("2026-12-01T22:00:00.000Z"),
        eventTable: aliceTable,
      },
    ],
  },
  {
    id: "g-mine",
    eventId: "evt1",
    rsvpId: "r-me",
    participantType: "GUEST",
    discordUserId: null,
    displayName: "Pat",
    signupRole: null,
    backupDmStatus: null,
    assignmentEligible: true,
    partyOwnerParticipantId: `evt1:${ACTOR}:primary`,
    assignments: [],
  },
  {
    id: `evt1:${OTHER}:primary`,
    eventId: "evt1",
    rsvpId: "r-other",
    participantType: "PRIMARY",
    discordUserId: OTHER,
    displayName: "Other Player",
    signupRole: "PLAYER",
    backupDmStatus: null,
    assignmentEligible: true,
    partyOwnerParticipantId: null,
    assignments: [],
  },
];

const rsvps = [
  {
    id: "r-me",
    eventId: "evt1",
    primaryDiscordUserId: ACTOR,
    status: "GOING",
    signupRole: "PLAYER",
    selectedCategory: "NORMAL",
  },
  {
    id: "r-other",
    eventId: "evt1",
    primaryDiscordUserId: OTHER,
    status: "GOING",
    signupRole: "PLAYER",
    selectedCategory: "HEROIC",
  },
];

function makeService(options: { event?: unknown | null } = {}) {
  const calls: Array<{ model: string; args: any }> = [];
  const loadedEvent = options.event === undefined ? event : options.event;
  const prisma = {
    client: {
      event: {
        findUnique: async (args: any) => {
          calls.push({ model: "event", args });
          return args.where.id === "evt1" ? loadedEvent : null;
        },
      },
      rSVP: {
        findUnique: async (args: any) => {
          calls.push({ model: "rSVP", args });
          const key = args.where.eventId_primaryDiscordUserId;
          const row = rsvps.find(
            (r) =>
              r.eventId === key.eventId &&
              r.primaryDiscordUserId === key.primaryDiscordUserId,
          );
          if (!row) return null;
          return {
            ...row,
            participants: participants.filter((p) => p.rsvpId === row.id),
          };
        },
      },
      eventTable: {
        findMany: async (args: any) => {
          calls.push({ model: "eventTable", args });
          const wantedActor = args.where.ambassadorProfile?.discordUserId;
          return [aliceTable, zedTable].filter(
            (t) =>
              t.ambassadorProfile.discordUserId === wantedActor &&
              !(args.where.status?.notIn ?? []).includes(t.status),
          );
        },
      },
    },
  };
  const noop = {} as never;
  const service = new EventsService(prisma as never, noop, noop, noop, noop);
  return { service, calls };
}

describe("EventsService.getMySignup", () => {
  it("returns the actor's released seat, own guests and actions only", async () => {
    const { service } = makeService();
    const view = await service.getMySignup("evt1", ACTOR);

    expect(view.participation.state).toBe("PLAYER");
    expect(view.seat).toEqual({
      code: "CONFIRMED_SEAT",
      table: { title: "Alice's Table", tableType: "NORMAL", gmName: "Alice" },
    });
    expect(view.guests.map((g) => g.displayName)).toEqual(["Pat"]);
    expect(view.actions.cancel).toBe(true);
    expect(view.actions.editGuests).toBe(false); // assignments locked

    const json = JSON.stringify(view);
    for (const leaked of [
      OTHER,
      THIRD,
      "Other Player",
      "Zed",
      "organizer-secret",
    ]) {
      expect(json).not.toContain(leaked);
    }
  });

  it("another user's registration is never visible to the actor", async () => {
    const { service } = makeService();
    const view = await service.getMySignup("evt1", "400000000000000004");
    expect(view.participation.state).toBe("NONE");
    expect(view.guests).toEqual([]);
    expect(JSON.stringify(view)).not.toMatch(/Other Player|Pat|Alice|Zed/);
  });

  it("scopes every query to the actor and never loads roster, audit or preferences", async () => {
    const { service, calls } = makeService();
    await service.getMySignup("evt1", ACTOR);

    const rsvpCall = calls.find((c) => c.model === "rSVP")!;
    expect(rsvpCall.args.where).toEqual({
      eventId_primaryDiscordUserId: {
        eventId: "evt1",
        primaryDiscordUserId: ACTOR,
      },
    });
    const tableCall = calls.find((c) => c.model === "eventTable")!;
    expect(tableCall.args.where.ambassadorProfile).toEqual({
      discordUserId: ACTOR,
    });

    const requested = JSON.stringify(calls.map((c) => c.args));
    for (const forbidden of [
      "auditLogs",
      "messageJobs",
      "signupPreferences",
      "eligibilityRules",
      "seatingGroups",
      "attendanceRecords",
      "feedbackRequests",
      "roles",
    ]) {
      expect(requested).not.toContain(forbidden);
    }
    // The event is loaded with an explicit allow-list select.
    const eventCall = calls.find((c) => c.model === "event")!;
    expect(eventCall.args.select).toBeDefined();
    expect(eventCall.args.select.createdByDiscordId).toBeUndefined();
  });

  it("rejects a missing or malformed actor before touching the database", async () => {
    const { service, calls } = makeService();
    for (const bad of [
      "",
      "u1",
      `${ACTOR}\n`,
      "1".repeat(40),
      undefined as never,
    ]) {
      await expect(service.getMySignup("evt1", bad)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
    expect(calls).toEqual([]);
  });

  it("404s for an unknown event", async () => {
    const { service } = makeService();
    await expect(service.getMySignup("nope", ACTOR)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
