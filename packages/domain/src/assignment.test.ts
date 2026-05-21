import { describe, expect, it } from "vitest";
import {
  assignParticipantsToTables,
  backupDmCustomId,
  canParticipantUseTable,
  checkEligibility,
  computeBackupDmAskScheduledFor,
  computePostEventScheduledFor,
  computePreEventScheduledFor,
  computeReminderScheduledFor,
  parseBackupDmCustomId,
  type AssignmentParticipant,
  type AssignmentTable,
} from "./index.js";

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeParticipant(
  overrides: Partial<AssignmentParticipant> & { id: string },
): AssignmentParticipant {
  return {
    displayName: overrides.id,
    partyKey: overrides.id,
    category: "NORMAL",
    ...overrides,
  };
}

function makeTable(
  overrides: Partial<AssignmentTable> & { id: string },
): AssignmentTable {
  return {
    title: overrides.id,
    tableType: "NORMAL",
    softCap: 6,
    hardCap: 7,
    locked: false,
    hasDm: true,
    existingParticipantIds: [],
    ...overrides,
  };
}

// ─── Track / category matching ────────────────────────────────────────────

describe("canParticipantUseTable — strict track equality", () => {
  it("allows NORMAL player at NORMAL table", () => {
    expect(
      canParticipantUseTable(
        makeParticipant({ id: "p", category: "NORMAL" }),
        makeTable({ id: "t", tableType: "NORMAL" }),
      ),
    ).toBe(true);
  });

  it("blocks NORMAL player at HEROIC table", () => {
    expect(
      canParticipantUseTable(
        makeParticipant({ id: "p", category: "NORMAL" }),
        makeTable({ id: "t", tableType: "HEROIC" }),
      ),
    ).toBe(false);
  });

  it("blocks HEROIC player at NORMAL table", () => {
    expect(
      canParticipantUseTable(
        makeParticipant({ id: "p", category: "HEROIC" }),
        makeTable({ id: "t", tableType: "NORMAL" }),
      ),
    ).toBe(false);
  });

  it("allows HEROIC player at HEROIC table", () => {
    expect(
      canParticipantUseTable(
        makeParticipant({ id: "p", category: "HEROIC" }),
        makeTable({ id: "t", tableType: "HEROIC" }),
      ),
    ).toBe(false === false); // true
  });

  it("allows MIXED player at MIXED table", () => {
    expect(
      canParticipantUseTable(
        makeParticipant({ id: "p", category: "MIXED" }),
        makeTable({ id: "t", tableType: "MIXED" }),
      ),
    ).toBe(true);
  });

  it("blocks MIXED player at NORMAL table", () => {
    expect(
      canParticipantUseTable(
        makeParticipant({ id: "p", category: "MIXED" }),
        makeTable({ id: "t", tableType: "NORMAL" }),
      ),
    ).toBe(false);
  });

  it("blocks MIXED player at HEROIC table", () => {
    expect(
      canParticipantUseTable(
        makeParticipant({ id: "p", category: "MIXED" }),
        makeTable({ id: "t", tableType: "HEROIC" }),
      ),
    ).toBe(false);
  });

  it("blocks NORMAL player at MIXED table", () => {
    expect(
      canParticipantUseTable(
        makeParticipant({ id: "p", category: "NORMAL" }),
        makeTable({ id: "t", tableType: "MIXED" }),
      ),
    ).toBe(false);
  });

  it("blocks HEROIC player at MIXED table", () => {
    expect(
      canParticipantUseTable(
        makeParticipant({ id: "p", category: "HEROIC" }),
        makeTable({ id: "t", tableType: "MIXED" }),
      ),
    ).toBe(false);
  });
});

// ─── MIXED track integration tests ────────────────────────────────────────
// MIXED is used for non-D&D games (e.g. Daggerheart) where all participants
// share the same category. D&D players (NORMAL/HEROIC) never sit at MIXED tables.

describe("MIXED track — integration", () => {
  it("seats MIXED player at MIXED table when both MIXED and NORMAL tables exist", () => {
    const result = assignParticipantsToTables(
      [makeParticipant({ id: "p1", category: "MIXED" })],
      [
        makeTable({ id: "normal-t", tableType: "NORMAL" }),
        makeTable({ id: "mixed-t", tableType: "MIXED" }),
      ],
    );
    expect(result.decisions[0]?.tableId).toBe("mixed-t");
    expect(result.decisions[0]?.status).toBe("ASSIGNED");
  });

  it("waitlists NORMAL player when only a MIXED table exists", () => {
    const result = assignParticipantsToTables(
      [makeParticipant({ id: "p1", category: "NORMAL" })],
      [makeTable({ id: "mixed-t", tableType: "MIXED" })],
    );
    expect(result.decisions[0]?.status).toBe("WAITLISTED");
    expect(result.decisions[0]?.reasonCode).toBe("waitlisted_track_mismatch");
  });

  it("waitlists HEROIC player when only a MIXED table exists", () => {
    const result = assignParticipantsToTables(
      [makeParticipant({ id: "p1", category: "HEROIC" })],
      [makeTable({ id: "mixed-t", tableType: "MIXED" })],
    );
    expect(result.decisions[0]?.status).toBe("WAITLISTED");
    expect(result.decisions[0]?.reasonCode).toBe("waitlisted_track_mismatch");
  });

  it("does not seat MIXED player at NORMAL table even when MIXED table is full", () => {
    const result = assignParticipantsToTables(
      [
        makeParticipant({ id: "p1", category: "MIXED" }),
        makeParticipant({ id: "p2", category: "MIXED" }),
      ],
      [
        // MIXED table already at hard cap
        makeTable({
          id: "mixed-t",
          tableType: "MIXED",
          softCap: 1,
          hardCap: 1,
        }),
        makeTable({ id: "normal-t", tableType: "NORMAL" }),
      ],
    );
    // First player seated, second waitlisted (not bumped to NORMAL table)
    const seated = result.decisions.find((d) => d.status === "ASSIGNED");
    const waitlisted = result.decisions.find((d) => d.status === "WAITLISTED");
    expect(seated?.tableId).toBe("mixed-t");
    expect(waitlisted?.reasonCode).not.toBe("waitlisted_track_mismatch");
  });
});

// ─── Priority test 1: Normal player must not be seated at Heroic table ────

describe("priority 1 — Normal player cannot be seated at Heroic table", () => {
  it("waitlists Normal player when only a Heroic table exists", () => {
    const result = assignParticipantsToTables(
      [makeParticipant({ id: "p1", category: "NORMAL" })],
      [makeTable({ id: "t1", tableType: "HEROIC" })],
    );

    expect(result.decisions[0]?.status).toBe("WAITLISTED");
    expect(result.decisions[0]?.reasonCode).toBe("waitlisted_track_mismatch");
    expect(result.warnings.some((w) => w.code === "PARTY_WAITLISTED")).toBe(true);
  });

  it("seats Normal player at Normal table when both track types exist", () => {
    const result = assignParticipantsToTables(
      [makeParticipant({ id: "p1", category: "NORMAL" })],
      [
        makeTable({ id: "heroic", tableType: "HEROIC" }),
        makeTable({ id: "normal", tableType: "NORMAL" }),
      ],
    );

    expect(result.decisions[0]?.tableId).toBe("normal");
    expect(result.decisions[0]?.status).toBe("ASSIGNED");
  });
});

// ─── Priority test 2: Heroic player must not be seated at Normal table ────

describe("priority 2 — Heroic player cannot be seated at Normal table", () => {
  it("waitlists Heroic player when only a Normal table exists", () => {
    const result = assignParticipantsToTables(
      [makeParticipant({ id: "p1", category: "HEROIC" })],
      [makeTable({ id: "t1", tableType: "NORMAL" })],
    );

    expect(result.decisions[0]?.status).toBe("WAITLISTED");
    expect(result.decisions[0]?.reasonCode).toBe("waitlisted_track_mismatch");
  });

  it("seats Heroic player at Heroic table", () => {
    const result = assignParticipantsToTables(
      [makeParticipant({ id: "p1", category: "HEROIC" })],
      [
        makeTable({ id: "normal", tableType: "NORMAL" }),
        makeTable({ id: "heroic", tableType: "HEROIC" }),
      ],
    );

    expect(result.decisions[0]?.tableId).toBe("heroic");
    expect(result.decisions[0]?.status).toBe("ASSIGNED");
  });
});

// ─── Priority test 2b: No matching DM → waitlist with reason ─────────────

describe("priority 2b — no matching DM means waitlist, not wrong-track assignment", () => {
  it("waitlists Normal player with reason=waitlisted_no_matching_dm when no Normal DM exists", () => {
    const result = assignParticipantsToTables(
      [makeParticipant({ id: "p1", category: "NORMAL" })],
      // NORMAL table but no DM confirmed
      [makeTable({ id: "t1", tableType: "NORMAL", hasDm: false })],
    );

    expect(result.decisions[0]?.status).toBe("WAITLISTED");
    expect(result.decisions[0]?.reasonCode).toBe("waitlisted_no_matching_dm");
  });

  it("seats Normal player at Normal table with confirmed DM", () => {
    const result = assignParticipantsToTables(
      [makeParticipant({ id: "p1", category: "NORMAL" })],
      [makeTable({ id: "t1", tableType: "NORMAL", hasDm: true })],
    );

    expect(result.decisions[0]?.status).toBe("ASSIGNED");
    expect(result.decisions[0]?.tableId).toBe("t1");
  });

  it("waitlists with waitlisted_no_capacity when matching DM exists but table is full", () => {
    const result = assignParticipantsToTables(
      [makeParticipant({ id: "p1", category: "NORMAL" })],
      [
        makeTable({
          id: "t1",
          tableType: "NORMAL",
          hasDm: true,
          hardCap: 2,
          existingParticipantIds: ["x1", "x2"],
        }),
      ],
    );

    expect(result.decisions[0]?.status).toBe("WAITLISTED");
    expect(result.decisions[0]?.reasonCode).toBe("waitlisted_no_capacity");
  });
});

// ─── Legacy: party cohesion and hard cap ──────────────────────────────────

describe("party cohesion and hard caps", () => {
  it("keeps guests with their RSVP owner and respects hard caps", () => {
    const result = assignParticipantsToTables(
      [
        makeParticipant({ id: "p1", category: "NORMAL", partyKey: "p1" }),
        makeParticipant({ id: "g1", category: "NORMAL", partyKey: "p1" }),
        makeParticipant({ id: "p2", category: "NORMAL", partyKey: "p2" }),
      ],
      [
        makeTable({ id: "t1", tableType: "NORMAL", softCap: 2, hardCap: 2 }),
        makeTable({ id: "t2", tableType: "NORMAL", softCap: 2, hardCap: 2 }),
      ],
    );

    expect(
      result.decisions.filter((d) => d.tableId === "t1"),
    ).toHaveLength(2);
    expect(
      result.decisions.find((d) => d.participantId === "p2")?.tableId,
    ).toBe("t2");
  });

  it("waitlists a party when no eligible hard-cap space exists", () => {
    const result = assignParticipantsToTables(
      [
        makeParticipant({ id: "p1", category: "NORMAL", partyKey: "p1" }),
        makeParticipant({ id: "g1", category: "NORMAL", partyKey: "p1" }),
      ],
      [makeTable({ id: "t1", tableType: "HEROIC", softCap: 6, hardCap: 7 })],
    );

    expect(result.decisions.every((d) => d.status === "WAITLISTED")).toBe(true);
    expect(result.warnings.some((w) => w.code === "PARTY_WAITLISTED")).toBe(true);
  });
});

// ─── Reason codes ─────────────────────────────────────────────────────────

describe("assignment decision records reason code", () => {
  it("records assigned_to_matching_table on successful assignment", () => {
    const result = assignParticipantsToTables(
      [makeParticipant({ id: "p1", category: "NORMAL" })],
      [makeTable({ id: "t1", tableType: "NORMAL" })],
    );
    expect(result.decisions[0]?.reasonCode).toBe("assigned_to_matching_table");
  });

  it("records waitlisted_track_mismatch when no track matches", () => {
    const result = assignParticipantsToTables(
      [makeParticipant({ id: "p1", category: "NORMAL" })],
      [makeTable({ id: "t1", tableType: "HEROIC" })],
    );
    expect(result.decisions[0]?.reasonCode).toBe("waitlisted_track_mismatch");
  });
});

// ─── Priority test 5: avoid-player and avoid-DM hard constraints ──────────

describe("priority 5 — avoid player and avoid DM are hard blocks", () => {
  it("blocks assignment when player avoids another player already at the table", () => {
    const existingOccupant = "occupant1";
    const result = assignParticipantsToTables(
      [
        makeParticipant({
          id: "p1",
          category: "NORMAL",
          avoidParticipantIds: [existingOccupant],
        }),
      ],
      [
        makeTable({
          id: "t1",
          tableType: "NORMAL",
          existingParticipantIds: [existingOccupant],
        }),
      ],
    );

    expect(result.decisions[0]?.status).toBe("WAITLISTED");
    expect(result.decisions[0]?.reasonCode).toBe("waitlisted_conflict_constraint");
    expect(result.warnings.some((w) => w.code === "AVOID_CONSTRAINT_APPLIED")).toBe(true);
  });

  it("avoids DM table when player has avoid-table constraint", () => {
    const result = assignParticipantsToTables(
      [
        makeParticipant({
          id: "p1",
          category: "NORMAL",
          avoidTableIds: ["t1"],
        }),
      ],
      [
        makeTable({ id: "t1", tableType: "NORMAL" }),
        makeTable({ id: "t2", tableType: "NORMAL" }),
      ],
    );

    expect(result.decisions[0]?.tableId).toBe("t2");
    expect(result.decisions[0]?.status).toBe("ASSIGNED");
  });

  it("waitlists when avoid-table constraint eliminates only option", () => {
    const result = assignParticipantsToTables(
      [makeParticipant({ id: "p1", category: "NORMAL", avoidTableIds: ["t1"] })],
      [makeTable({ id: "t1", tableType: "NORMAL" })],
    );

    expect(result.decisions[0]?.status).toBe("WAITLISTED");
  });

  it("seats player without conflict when avoid list does not match any occupant", () => {
    const result = assignParticipantsToTables(
      [makeParticipant({ id: "p1", category: "NORMAL", avoidParticipantIds: ["nobody"] })],
      [makeTable({ id: "t1", tableType: "NORMAL" })],
    );

    expect(result.decisions[0]?.status).toBe("ASSIGNED");
  });

  it("prefer constraint seats player at preferred table when available", () => {
    const result = assignParticipantsToTables(
      [makeParticipant({ id: "p1", category: "NORMAL", preferredTableIds: ["t2"] })],
      [
        makeTable({ id: "t1", tableType: "NORMAL" }),
        makeTable({ id: "t2", tableType: "NORMAL" }),
      ],
    );

    expect(result.decisions[0]?.tableId).toBe("t2");
  });
});

// ─── Priority test 6: do-not-split seating group ─────────────────────────

describe("priority 6 — do-not-split group seated together or waitlisted together", () => {
  it("seats a two-person party together when space exists", () => {
    const result = assignParticipantsToTables(
      [
        makeParticipant({ id: "p1", category: "NORMAL", partyKey: "group1" }),
        makeParticipant({ id: "p2", category: "NORMAL", partyKey: "group1" }),
      ],
      [makeTable({ id: "t1", tableType: "NORMAL", softCap: 6, hardCap: 7 })],
    );

    const tableIds = result.decisions.map((d) => d.tableId);
    expect(tableIds[0]).toBe(tableIds[1]);
    expect(result.decisions.every((d) => d.status === "ASSIGNED")).toBe(true);
  });

  it("waitlists a two-person party together when only one seat remains", () => {
    const result = assignParticipantsToTables(
      [
        makeParticipant({ id: "p1", category: "NORMAL", partyKey: "group1" }),
        makeParticipant({ id: "p2", category: "NORMAL", partyKey: "group1" }),
      ],
      [
        makeTable({
          id: "t1",
          tableType: "NORMAL",
          hardCap: 1,
          existingParticipantIds: [],
        }),
      ],
    );

    expect(result.decisions.every((d) => d.status === "WAITLISTED")).toBe(true);
    expect(result.warnings.some((w) => w.code === "PARTY_WAITLISTED")).toBe(true);
  });
});

// ─── Eligibility rule checks ──────────────────────────────────────────────

describe("eligibility rule enforcement", () => {
  it("returns eligible when no rule exists", () => {
    expect(checkEligibility(null, ["roleA"])).toEqual({ eligible: true });
  });

  it("denied role blocks signup even if allowed role is also present", () => {
    const result = checkEligibility(
      {
        allowedDiscordRoleIds: ["allow"],
        requiredDiscordRoleIds: [],
        deniedDiscordRoleIds: ["deny"],
        requiresApproval: false,
      },
      ["allow", "deny"],
    );
    expect(result.eligible).toBe(false);
  });

  it("user without required role cannot sign up as table DM", () => {
    const result = checkEligibility(
      {
        allowedDiscordRoleIds: [],
        requiredDiscordRoleIds: ["dm-certified"],
        deniedDiscordRoleIds: [],
        requiresApproval: false,
      },
      ["player-role"],
    );
    expect(result.eligible).toBe(false);
  });

  it("user with required role can sign up", () => {
    const result = checkEligibility(
      {
        allowedDiscordRoleIds: [],
        requiredDiscordRoleIds: ["dm-certified"],
        deniedDiscordRoleIds: [],
        requiresApproval: false,
      },
      ["dm-certified", "player-role"],
    );
    expect(result.eligible).toBe(true);
  });

  it("allowed list: user without any allowed role is blocked", () => {
    const result = checkEligibility(
      {
        allowedDiscordRoleIds: ["roleA", "roleB"],
        requiredDiscordRoleIds: [],
        deniedDiscordRoleIds: [],
        requiresApproval: false,
      },
      ["roleC"],
    );
    expect(result.eligible).toBe(false);
  });

  it("allowed list: user with one of the allowed roles is permitted", () => {
    const result = checkEligibility(
      {
        allowedDiscordRoleIds: ["roleA", "roleB"],
        requiredDiscordRoleIds: [],
        deniedDiscordRoleIds: [],
        requiresApproval: false,
      },
      ["roleB"],
    );
    expect(result.eligible).toBe(true);
  });

  it("requiresApproval is surfaced on eligible result", () => {
    const result = checkEligibility(
      {
        allowedDiscordRoleIds: ["roleA"],
        requiredDiscordRoleIds: [],
        deniedDiscordRoleIds: [],
        requiresApproval: true,
      },
      ["roleA"],
    );
    expect(result.eligible).toBe(true);
    expect((result as { eligible: true; requiresApproval?: boolean }).requiresApproval).toBe(true);
  });
});

// ─── Message job scheduling helpers ──────────────────────────────────────

describe("message job scheduling helpers", () => {
  it("pre-event message is scheduled 2 hours before startAt", () => {
    const start = new Date("2026-08-01T18:00:00Z");
    const scheduled = computePreEventScheduledFor(start);
    expect(scheduled.toISOString()).toBe("2026-08-01T16:00:00.000Z");
  });

  it("post-event message is scheduled 1 hour after endAt", () => {
    const end = new Date("2026-08-01T22:00:00Z");
    const scheduled = computePostEventScheduledFor(end);
    expect(scheduled.toISOString()).toBe("2026-08-01T23:00:00.000Z");
  });

  it("pre-event scheduledFor is always before startAt", () => {
    const start = new Date("2026-12-25T19:00:00Z");
    expect(computePreEventScheduledFor(start).getTime()).toBeLessThan(start.getTime());
  });

  it("post-event scheduledFor is always after endAt", () => {
    const end = new Date("2026-12-25T23:00:00Z");
    expect(computePostEventScheduledFor(end).getTime()).toBeGreaterThan(end.getTime());
  });

  it("reminder is scheduled 4 hours before startAt", () => {
    const start = new Date("2026-08-01T18:00:00Z");
    expect(computeReminderScheduledFor(start).toISOString()).toBe("2026-08-01T14:00:00.000Z");
  });

  it("backup DM ask is scheduled 3 hours before startAt", () => {
    const start = new Date("2026-08-01T18:00:00Z");
    expect(computeBackupDmAskScheduledFor(start).toISOString()).toBe("2026-08-01T15:00:00.000Z");
  });

  it("reminder fires before backup DM ask, which fires before pre-event", () => {
    const start = new Date("2026-08-01T18:00:00Z");
    const reminder = computeReminderScheduledFor(start);
    const backupAsk = computeBackupDmAskScheduledFor(start);
    const pre = computePreEventScheduledFor(start);
    expect(reminder.getTime()).toBeLessThan(backupAsk.getTime());
    expect(backupAsk.getTime()).toBeLessThan(pre.getTime());
  });
});

// ─── Backup DM custom ID helpers ──────────────────────────────────────────

describe("backup DM custom ID helpers", () => {
  it("encodes accept action correctly", () => {
    const id = backupDmCustomId("accept", "evt-123", "part-456");
    expect(id).toBe("backupdm:accept:evt-123:part-456");
  });

  it("encodes decline action correctly", () => {
    const id = backupDmCustomId("decline", "evt-123", "part-456");
    expect(id).toBe("backupdm:decline:evt-123:part-456");
  });

  it("roundtrips accept correctly", () => {
    const id = backupDmCustomId("accept", "evt-abc", "part-xyz");
    const parsed = parseBackupDmCustomId(id);
    expect(parsed).toEqual({ action: "accept", eventId: "evt-abc", participantId: "part-xyz" });
  });

  it("roundtrips decline correctly", () => {
    const id = backupDmCustomId("decline", "evt-abc", "part-xyz");
    const parsed = parseBackupDmCustomId(id);
    expect(parsed).toEqual({ action: "decline", eventId: "evt-abc", participantId: "part-xyz" });
  });

  it("returns null for unrelated custom IDs", () => {
    expect(parseBackupDmCustomId("rsvp:evt-123:NORMAL")).toBeNull();
    expect(parseBackupDmCustomId("assignment:evt-123")).toBeNull();
    expect(parseBackupDmCustomId("backupdm:unknown:evt:part")).toBeNull();
    expect(parseBackupDmCustomId("")).toBeNull();
  });

  it("returns null when parts are missing", () => {
    expect(parseBackupDmCustomId("backupdm:accept:evt-only")).toBeNull();
    expect(parseBackupDmCustomId("backupdm:accept")).toBeNull();
  });
});

// ─── Assignment lock idempotency (domain layer) ───────────────────────────
// Lock-related idempotency (double-lock prevention) is enforced in the
// EventsService via a BadRequestException guard, not in the domain engine.
// The domain engine itself does not carry lock state — it is stateless.
// These tests confirm the engine produces stable decisions on repeated runs
// with the same inputs (the invariant lockAssignments relies on).

describe("assignment engine is deterministic (lock idempotency invariant)", () => {
  it("produces identical decisions on two runs with the same participants and tables", () => {
    const participants = [
      makeParticipant({ id: "p1", category: "NORMAL" }),
      makeParticipant({ id: "p2", category: "NORMAL" }),
      makeParticipant({ id: "p3", category: "HEROIC" }),
    ];
    const tables = [
      makeTable({ id: "t-normal", tableType: "NORMAL", softCap: 4, hardCap: 6 }),
      makeTable({ id: "t-heroic", tableType: "HEROIC", softCap: 4, hardCap: 6 }),
    ];

    const run1 = assignParticipantsToTables(participants, tables);
    const run2 = assignParticipantsToTables(participants, tables);

    expect(run1.decisions).toEqual(run2.decisions);
    expect(run1.warnings.length).toBe(run2.warnings.length);
  });

  it("seated decisions do not change when additional unrelated participants are added after", () => {
    const core = [makeParticipant({ id: "p1", category: "NORMAL" })];
    const table = [makeTable({ id: "t1", tableType: "NORMAL" })];

    const first = assignParticipantsToTables(core, table);
    expect(first.decisions[0]?.status).toBe("ASSIGNED");
    expect(first.decisions[0]?.tableId).toBe("t1");

    // Simulate a locked assignment preserved in a second run.
    const coreWithLock = [
      makeParticipant({ id: "p1", category: "NORMAL", lockedTableId: "t1" }),
      makeParticipant({ id: "p2", category: "NORMAL" }),
    ];
    const second = assignParticipantsToTables(coreWithLock, table);
    const p1Decision = second.decisions.find((d) => d.participantId === "p1");
    expect(p1Decision?.tableId).toBe("t1");
    expect(p1Decision?.reasonCode).toBe("locked_assignment_preserved");
  });
});
