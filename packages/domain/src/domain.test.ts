import { describe, expect, it } from "vitest";
import {
  assignParticipantsToTables,
  checkEligibility,
  eventSeriesCreateSchema,
  guestUpdateSchema,
  makeDateInTimezone,
  nextWeekdayDate,
  nextWeekdayDateInTimezone,
  WEEKDAY_TO_JS,
  type AssignmentParticipant,
  type AssignmentTable,
} from "./index.js";

// ─── nextWeekdayDate ──────────────────────────────────────────────────────────

describe("nextWeekdayDate", () => {
  it("returns the next Friday when called on a Monday", () => {
    const monday = new Date(2026, 4, 25); // May 25 2026 local time — a Monday
    expect(monday.getDay()).toBe(1);
    const result = nextWeekdayDate(monday, WEEKDAY_TO_JS.FRI!);
    expect(result.getDay()).toBe(5); // Friday
    expect(result > monday).toBe(true);
  });

  it("skips the same day and goes to next week when already on the target day", () => {
    // Use local-time constructor to avoid UTC-offset getDay() skew
    const friday = new Date(2026, 4, 22); // May 22 2026 local time — a Friday
    expect(friday.getDay()).toBe(5); // sanity-check the fixture
    const result = nextWeekdayDate(friday, WEEKDAY_TO_JS.FRI!);
    expect(result.getDay()).toBe(5);
    expect(result.getTime()).toBeGreaterThan(friday.getTime());
    const diffDays = Math.round((result.getTime() - friday.getTime()) / (24 * 60 * 60 * 1000));
    expect(diffDays).toBe(7);
  });

  it("returns next Monday when called on a Saturday", () => {
    const saturday = new Date(2026, 4, 23); // May 23 2026 local time — a Saturday
    expect(saturday.getDay()).toBe(6);
    const result = nextWeekdayDate(saturday, WEEKDAY_TO_JS.MON!);
    expect(result.getDay()).toBe(1); // Monday
    const diffDays = Math.round((result.getTime() - saturday.getTime()) / (24 * 60 * 60 * 1000));
    expect(diffDays).toBe(2);
  });
});

// ─── nextWeekdayDateInTimezone ────────────────────────────────────────────────

describe("nextWeekdayDateInTimezone", () => {
  it("finds next Friday from Monday in Eastern time", () => {
    // 2026-05-25 00:00 UTC = 2026-05-24 20:00 EDT (Sunday night Eastern)
    // So weekday in Eastern is Sunday → next Friday should be May 29
    const mondayUtc = new Date("2026-05-25T12:00:00Z"); // noon UTC Monday = Monday Eastern
    const result = nextWeekdayDateInTimezone(mondayUtc, WEEKDAY_TO_JS.FRI!, "America/New_York");
    const dayInEastern = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", weekday: "short",
    }).format(result);
    expect(dayInEastern).toBe("Fri");
    expect(result.getTime()).toBeGreaterThan(mondayUtc.getTime());
  });

  it("skips to next week when already on the target weekday (Friday)", () => {
    // 2026-05-22T18:00:00Z = 2pm EDT Friday May 22
    const friday = new Date("2026-05-22T18:00:00Z");
    const result = nextWeekdayDateInTimezone(friday, WEEKDAY_TO_JS.FRI!, "America/New_York");
    const diffMs = result.getTime() - friday.getTime();
    const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
    expect(diffDays).toBe(7);
  });

  it("uses pure ms arithmetic — result is always targetDay * 24h * n away", () => {
    // Any UTC instant on Monday noon; next Wednesday is +2 days
    const monday = new Date("2026-05-25T12:00:00Z");
    const result = nextWeekdayDateInTimezone(monday, WEEKDAY_TO_JS.WED!, "America/New_York");
    const diffMs = result.getTime() - monday.getTime();
    expect(diffMs).toBe(2 * 24 * 60 * 60 * 1000);
  });
});

// ─── makeDateInTimezone ───────────────────────────────────────────────────────

describe("makeDateInTimezone", () => {
  it("produces correct UTC for 6pm Eastern (EDT, UTC-4) on a summer date", () => {
    // June 5 2026 18:00 EDT = 22:00 UTC
    const result = makeDateInTimezone(2026, 6, 5, 18, 0, "America/New_York");
    expect(result.getUTCHours()).toBe(22);
    expect(result.getUTCDate()).toBe(5);
    expect(result.getUTCMonth()).toBe(5); // 0-based
  });

  it("produces correct UTC for 6pm Eastern (EST, UTC-5) on a winter date", () => {
    // January 9 2026 18:00 EST = 23:00 UTC
    const result = makeDateInTimezone(2026, 1, 9, 18, 0, "America/New_York");
    expect(result.getUTCHours()).toBe(23);
    expect(result.getUTCDate()).toBe(9);
  });

  it("handles the DST spring-forward boundary (2026-03-08 in New York)", () => {
    // 2026-03-08 at 2:30am does not exist in Eastern; 18:00 is fine (EDT = UTC-4)
    const result = makeDateInTimezone(2026, 3, 8, 18, 0, "America/New_York");
    // After spring forward, EDT is UTC-4 → 18:00 EDT = 22:00 UTC
    expect(result.getUTCHours()).toBe(22);
  });
});

// ─── eventSeriesCreateSchema ──────────────────────────────────────────────────

describe("eventSeriesCreateSchema", () => {
  const base = {
    guildId: "123",
    name: "Friday Night D&D",
    defaultChannelId: "456",
    recurrenceRule: "WEEKLY:FRI",
    createdByDiscordId: "789",
  };

  it("accepts a valid WEEKLY series", () => {
    const result = eventSeriesCreateSchema.parse(base);
    expect(result.recurrenceRule).toBe("WEEKLY:FRI");
    expect(result.defaultStartHour).toBe(18);
    expect(result.defaultDurationMinutes).toBe(240);
  });

  it("rejects unsupported recurrence frequencies", () => {
    expect(() =>
      eventSeriesCreateSchema.parse({ ...base, recurrenceRule: "MONTHLY:1" }),
    ).toThrow();
    expect(() =>
      eventSeriesCreateSchema.parse({ ...base, recurrenceRule: "DAILY" }),
    ).toThrow();
  });

  it("rejects invalid day abbreviations", () => {
    expect(() =>
      eventSeriesCreateSchema.parse({ ...base, recurrenceRule: "WEEKLY:FRIDAY" }),
    ).toThrow();
  });

  it("accepts all valid weekday abbreviations", () => {
    for (const day of ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]) {
      expect(() =>
        eventSeriesCreateSchema.parse({ ...base, recurrenceRule: `WEEKLY:${day}` }),
      ).not.toThrow();
    }
  });
});

// ─── guestUpdateSchema ────────────────────────────────────────────────────────

describe("guestUpdateSchema", () => {
  it("accepts Discord guests (with discordUserId)", () => {
    const result = guestUpdateSchema.parse({
      discordUserId: "user1",
      guests: [{ displayName: "Alice", discordUserId: "alice123" }],
    });
    expect(result.guests[0]?.discordUserId).toBe("alice123");
  });

  it("accepts non-Discord guests (without discordUserId)", () => {
    const result = guestUpdateSchema.parse({
      discordUserId: "user1",
      guests: [{ displayName: "Jane Doe" }],
    });
    expect(result.guests[0]?.discordUserId).toBeUndefined();
    expect(result.guests[0]?.displayName).toBe("Jane Doe");
  });

  it("accepts mixed Discord and non-Discord guests", () => {
    const result = guestUpdateSchema.parse({
      discordUserId: "user1",
      guests: [
        { displayName: "Alice", discordUserId: "alice123" },
        { displayName: "Bob (non-Discord)" },
      ],
    });
    expect(result.guests).toHaveLength(2);
  });

  it("rejects guests with blank displayName", () => {
    expect(() =>
      guestUpdateSchema.parse({
        discordUserId: "user1",
        guests: [{ displayName: "  " }],
      }),
    ).toThrow();
  });

  it("allows an empty guest list (clearing all guests)", () => {
    const result = guestUpdateSchema.parse({
      discordUserId: "user1",
      guests: [],
    });
    expect(result.guests).toHaveLength(0);
  });
});

// ─── checkEligibility ─────────────────────────────────────────────────────────

describe("checkEligibility", () => {
  it("allows all when no rule configured", () => {
    expect(checkEligibility(null, ["some-role"])).toEqual({ eligible: true });
  });

  it("blocks member with a denied role", () => {
    const rule = {
      allowedDiscordRoleIds: [],
      requiredDiscordRoleIds: [],
      deniedDiscordRoleIds: ["banned-role"],
      requiresApproval: false,
    };
    const result = checkEligibility(rule, ["banned-role"]);
    expect(result.eligible).toBe(false);
  });

  it("allows member who has a required allowed role", () => {
    const rule = {
      allowedDiscordRoleIds: ["dm-role"],
      requiredDiscordRoleIds: [],
      deniedDiscordRoleIds: [],
      requiresApproval: false,
    };
    expect(checkEligibility(rule, ["dm-role", "other-role"])).toEqual({ eligible: true });
  });

  it("blocks member who lacks the allowed role", () => {
    const rule = {
      allowedDiscordRoleIds: ["dm-role"],
      requiredDiscordRoleIds: [],
      deniedDiscordRoleIds: [],
      requiresApproval: false,
    };
    const result = checkEligibility(rule, ["other-role"]);
    expect(result.eligible).toBe(false);
  });

  it("flags requiresApproval when rule specifies it", () => {
    const rule = {
      allowedDiscordRoleIds: [],
      requiredDiscordRoleIds: [],
      deniedDiscordRoleIds: [],
      requiresApproval: true,
    };
    const result = checkEligibility(rule, []);
    expect(result.eligible).toBe(true);
    expect((result as any).requiresApproval).toBe(true);
  });
});

// ─── Assignment: BACKUP_DM + Player coexistence ───────────────────────────────

function makeParticipant(overrides: Partial<AssignmentParticipant>): AssignmentParticipant {
  return {
    id: "p1",
    displayName: "Alice",
    partyKey: "p1",
    category: "MIXED",
    ...overrides,
  };
}

function makeTable(overrides: Partial<AssignmentTable>): AssignmentTable {
  return {
    id: "t1",
    title: "Table 1",
    tableType: "MIXED",
    softCap: 5,
    hardCap: 6,
    locked: false,
    hasDm: true,
    existingParticipantIds: [],
    ...overrides,
  };
}

describe("assignment engine", () => {
  it("assigns a MIXED player to a MIXED table", () => {
    const participants = [makeParticipant({ id: "p1", partyKey: "p1", category: "MIXED" })];
    const tables = [makeTable({ id: "t1", tableType: "MIXED" })];
    const result = assignParticipantsToTables(participants, tables);
    const seated = result.decisions.filter((d) => d.status === "ASSIGNED");
    expect(seated).toHaveLength(1);
    expect(seated[0]?.participantId).toBe("p1");
  });

  it("waitlists a NORMAL player when no NORMAL table exists", () => {
    const participants = [makeParticipant({ id: "p1", partyKey: "p1", category: "NORMAL" })];
    const tables = [makeTable({ id: "t1", tableType: "HEROIC" })];
    const result = assignParticipantsToTables(participants, tables);
    const seated = result.decisions.filter((d) => d.status === "ASSIGNED");
    expect(seated).toHaveLength(0);
    expect(result.decisions[0]?.status).toBe("WAITLISTED");
  });

  it("does not exceed hardCap", () => {
    const participants = Array.from({ length: 8 }, (_, i) =>
      makeParticipant({ id: `p${i}`, partyKey: `p${i}`, category: "MIXED" }),
    );
    const tables = [makeTable({ id: "t1", tableType: "MIXED", softCap: 5, hardCap: 6 })];
    const result = assignParticipantsToTables(participants, tables);
    const seated = result.decisions.filter((d) => d.status === "ASSIGNED");
    expect(seated.length).toBeLessThanOrEqual(6);
  });

  it("avoids seating a player at the same table as an avoided participant", () => {
    const p1 = makeParticipant({
      id: "p1",
      partyKey: "p1",
      category: "MIXED",
      avoidParticipantIds: ["p2"],
    });
    const p2 = makeParticipant({ id: "p2", partyKey: "p2", category: "MIXED" });
    const t1 = makeTable({ id: "t1", tableType: "MIXED", softCap: 2, hardCap: 2 });
    const t2 = makeTable({ id: "t2", tableType: "MIXED", softCap: 2, hardCap: 2 });
    const result = assignParticipantsToTables([p1, p2], [t1, t2]);
    const p1Dec = result.decisions.find((d) => d.participantId === "p1");
    const p2Dec = result.decisions.find((d) => d.participantId === "p2");
    // Both should be seated; if so, they must be at different tables
    if (p1Dec?.status === "ASSIGNED" && p2Dec?.status === "ASSIGNED") {
      expect(p1Dec.tableId).not.toBe(p2Dec.tableId);
    }
  });
});
