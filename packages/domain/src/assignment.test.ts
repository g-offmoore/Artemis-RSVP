import { describe, expect, it } from "vitest";
import { assignParticipantsToTables } from "./index.js";

describe("assignParticipantsToTables", () => {
  it("keeps guests with their RSVP owner and respects hard caps", () => {
    const result = assignParticipantsToTables(
      [
        { id: "p1", displayName: "Alex", partyKey: "p1", category: "NORMAL" },
        { id: "g1", displayName: "Guest", partyKey: "p1", category: "NORMAL" },
        { id: "p2", displayName: "Blair", partyKey: "p2", category: "NORMAL" }
      ],
      [
        { id: "t1", title: "Table 1", tableType: "NORMAL", softCap: 2, hardCap: 2, locked: false, existingParticipantIds: [] },
        { id: "t2", title: "Table 2", tableType: "NORMAL", softCap: 2, hardCap: 2, locked: false, existingParticipantIds: [] }
      ]
    );

    expect(result.decisions.filter((decision) => decision.tableId === "t1")).toHaveLength(2);
    expect(result.decisions.find((decision) => decision.participantId === "p2")?.tableId).toBe("t2");
  });

  it("waitlists a party when no eligible hard-cap space exists", () => {
    const result = assignParticipantsToTables(
      [
        { id: "p1", displayName: "Alex", partyKey: "p1", category: "NORMAL" },
        { id: "g1", displayName: "Guest", partyKey: "p1", category: "NORMAL" }
      ],
      [{ id: "t1", title: "Heroic", tableType: "HEROIC", softCap: 6, hardCap: 7, locked: false, existingParticipantIds: [] }]
    );

    expect(result.decisions.every((decision) => decision.status === "WAITLISTED")).toBe(true);
    expect(result.warnings.some((warning) => warning.code === "PARTY_WAITLISTED")).toBe(true);
  });
});
