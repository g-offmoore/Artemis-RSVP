import { describe, expect, it } from "vitest";
import {
  buildMySignupView,
  type MySignupSource,
  type MySignupView,
  type ParticipantSource,
} from "@artemis/domain";
import {
  buildCancelConfirm,
  buildJoinChoice,
  buildRunTableMessage,
  buildSignupPanel,
  toDiscordRows,
} from "./signup-panel.js";

// The renderer is fed views produced by the REAL buildMySignupView so these
// tests cover the view -> copy/controls contract, not a hand-written fixture.

const ACTOR = "100000000000000001";
const NOW = new Date("2026-11-20T12:00:00.000Z");
const LOCK = "2026-11-21T22:00:00.000Z";

const event = (o: Record<string, unknown> = {}): MySignupSource["event"] => ({
  id: "evt1",
  title: "Game Night",
  status: "SIGNUP_OPEN",
  gameSystem: "D&D",
  startAt: "2026-11-21T23:00:00.000Z",
  signupOpensAt: null,
  signupClosesAt: null,
  assignmentLockedAt: null,
  eventType: { allowsGuests: true, maxGuestsPerRsvp: 3 },
  ...o,
});

const primary = (o: Record<string, unknown> = {}): ParticipantSource =>
  ({
    id: `evt1:${ACTOR}:primary`,
    participantType: "PRIMARY",
    discordUserId: ACTOR,
    displayName: "Me",
    signupRole: "PLAYER",
    backupDmStatus: null,
    assignmentEligible: true,
    assignments: [],
    ...o,
  }) as ParticipantSource;

const guest = (id: string, name: string, o: Record<string, unknown> = {}) =>
  ({
    id,
    participantType: "GUEST",
    displayName: name,
    assignmentEligible: true,
    partyOwnerParticipantId: `evt1:${ACTOR}:primary`,
    assignments: [],
    ...o,
  }) as ParticipantSource;

const rsvp = (
  participants: ParticipantSource[],
  o: Record<string, unknown> = {},
) => ({
  primaryDiscordUserId: ACTOR,
  status: "GOING",
  signupRole: "PLAYER",
  selectedCategory: "NORMAL",
  participants,
  ...o,
});

const view = (s: Partial<MySignupSource>): MySignupView =>
  buildMySignupView(
    { event: event(), rsvp: null, tables: [], ...s },
    ACTOR,
    NOW,
  );

const seat = (status: string) => ({
  status,
  createdAt: "2026-11-20T10:00:00.000Z",
  eventTable: {
    title: "Alice's Table",
    tableType: "NORMAL",
    ambassadorProfile: { displayName: "Alice" },
  },
});

const labels = (m: { rows: Array<Array<{ label: string }>> }) =>
  m.rows.flat().map((b) => b.label);
const ids = (m: { rows: Array<Array<{ customId: string }>> }) =>
  m.rows.flat().map((b) => b.customId.split(":").slice(0, 2).join(":"));

describe("buildSignupPanel", () => {
  it("no registration: explains and offers Join and Run a table", () => {
    const m = buildSignupPanel(view({}), ACTOR);
    expect(m.content).toContain("not signed up");
    expect(labels(m)).toEqual(["Join", "Run a table"]);
  });

  it("registered player: status, guests, and explicit controls incl. cancel", () => {
    const m = buildSignupPanel(
      view({ rsvp: rsvp([primary(), guest("g1", "Pat")]) }),
      ACTOR,
      { backupEligible: true },
    );
    expect(m.content).toContain("signed up as a player");
    expect(m.content).toContain("Normal");
    expect(m.content).toContain("Guests (1/3)");
    expect(m.content).toContain("Pat");
    expect(labels(m)).toEqual([
      "Guests",
      "Preferences",
      "Add backup DM availability",
      "Cancel signup",
      "Refresh",
    ]);
    expect(ids(m)).toEqual([
      "guest:evt1",
      "prefs:evt1",
      "sp:backup",
      "sp:cancel",
      "sp:refresh",
    ]);
  });

  it("backup opt-in is hidden when the user is not eligible", () => {
    const m = buildSignupPanel(view({ rsvp: rsvp([primary()]) }), ACTOR, {
      backupEligible: false,
    });
    expect(labels(m)).not.toContain("Add backup DM availability");
  });

  it("player + backup: availability is distinct from the player signup", () => {
    const m = buildSignupPanel(
      view({
        rsvp: rsvp(
          [primary({ backupDmStatus: "BACKUP_AVAILABLE_AS_PLAYER" })],
          {
            signupRole: "BACKUP_DM",
          },
        ),
      }),
      ACTOR,
    );
    expect(m.content).toMatch(/Backup DM availability: \*\*on\*\*/);
    expect(m.content).toMatch(/keep your player signup/i);
    expect(m.content).toMatch(/asked before anything changes/i);
    expect(labels(m)).not.toContain("Add backup DM availability");
  });

  it("player + backup that was declined shows availability off", () => {
    const m = buildSignupPanel(
      view({
        rsvp: rsvp([primary({ backupDmStatus: "BACKUP_DECLINED_PULL" })], {
          signupRole: "BACKUP_DM",
        }),
      }),
      ACTOR,
      { backupEligible: true },
    );
    expect(m.content).toMatch(/Backup DM availability: off/);
    expect(labels(m)).toContain("Add backup DM availability");
  });

  it("active GM: GM role, table details, edit table; no player/cancel/backup/guests", () => {
    const m = buildSignupPanel(
      view({
        tables: [
          {
            id: "t1",
            title: "My Table",
            tableType: "HEROIC",
            softCap: 5,
            hardCap: 6,
            status: "OPEN",
            ambassadorProfile: { discordUserId: ACTOR, displayName: "Me" },
          },
        ],
      }),
      ACTOR,
    );
    expect(m.content).toContain("running a table");
    expect(m.content).toContain("My Table");
    expect(m.content).toContain("5/6");
    expect(m.content).toMatch(/contact an organizer/i);
    expect(m.content).not.toMatch(/signed up as a player/);
    expect(labels(m)).toEqual(["Edit table", "Refresh"]);
    expect(ids(m)[0]).toBe("host:evt1");
  });

  it("projected seat is tentative and never names a table", () => {
    const m = buildSignupPanel(
      view({
        rsvp: rsvp([primary({ assignments: [seat("PROJECTED_SEATED")] })]),
      }),
      ACTOR,
    );
    expect(m.content).toMatch(/not confirmed/i);
    expect(m.content).not.toMatch(/Alice/);
    expect(m.content).not.toMatch(/guarantee|reserved|your seat is/i);
  });

  it("projected waitlist is tentative and does not claim a seat", () => {
    const m = buildSignupPanel(
      view({
        rsvp: rsvp([
          primary({
            assignments: [
              { ...seat("PROJECTED_WAITLISTED"), eventTable: null },
            ],
          }),
        ]),
      }),
      ACTOR,
    );
    expect(m.content).toMatch(/waitlist/i);
    expect(m.content).toMatch(/not final/i);
    expect(m.content).not.toMatch(/confirmed seat/i);
  });

  it("released confirmed seat shows own table and GM", () => {
    const m = buildSignupPanel(
      view({
        event: event({ assignmentLockedAt: LOCK }),
        rsvp: rsvp([primary({ assignments: [seat("CONFIRMED_SEATED")] })]),
      }),
      ACTOR,
    );
    expect(m.content).toContain("Confirmed seat");
    expect(m.content).toContain("Alice's Table");
    expect(m.content).toContain("Alice");
  });

  it("released waitlist says there is no confirmed seat", () => {
    const m = buildSignupPanel(
      view({
        event: event({ assignmentLockedAt: LOCK }),
        rsvp: rsvp([
          primary({
            assignments: [
              { ...seat("CONFIRMED_WAITLISTED"), eventTable: null },
            ],
          }),
        ]),
      }),
      ACTOR,
    );
    expect(m.content).toMatch(/waitlist/i);
    expect(m.content).toMatch(/do not currently have a confirmed seat/i);
  });

  it("locked: explains restrictions; only cancel and refresh remain", () => {
    const m = buildSignupPanel(
      view({
        event: event({ assignmentLockedAt: LOCK }),
        rsvp: rsvp([primary()]),
      }),
      ACTOR,
      { backupEligible: true },
    );
    expect(m.content).toMatch(/locked/i);
    expect(labels(m)).toEqual(["Cancel signup", "Refresh"]);
  });

  it("cancelled event: copy only, no controls at all", () => {
    const m = buildSignupPanel(
      view({ event: event({ status: "CANCELLED" }), rsvp: rsvp([primary()]) }),
      ACTOR,
    );
    expect(m.content).toMatch(/cancelled/i);
    expect(m.rows).toEqual([]);
  });

  it("completed event: read-only copy, no controls", () => {
    const m = buildSignupPanel(
      view({ event: event({ status: "COMPLETED" }), rsvp: rsvp([primary()]) }),
      ACTOR,
    );
    expect(m.content).toMatch(/ended/i);
    expect(m.rows).toEqual([]);
  });

  it("an organizer-removed signup says so neutrally without reasons", () => {
    const m = buildSignupPanel(
      view({ rsvp: rsvp([primary()], { status: "REMOVED" }) }),
      ACTOR,
    );
    expect(m.content).toMatch(/not active/i);
    expect(m.rows).toEqual([]);
  });

  it("includes a notice line when provided", () => {
    const m = buildSignupPanel(view({}), ACTOR, { notice: "Nothing changed." });
    expect(m.content.startsWith("Nothing changed.")).toBe(true);
  });

  it("does not offer reminder preferences (P02 does not exist yet)", () => {
    const m = buildSignupPanel(view({ rsvp: rsvp([primary()]) }), ACTOR);
    expect(m.content + labels(m).join(" ")).not.toMatch(/remind/i);
  });

  it("buttons carry the actor and public post hint; ids fit Discord limits", () => {
    const m = buildSignupPanel(view({ rsvp: rsvp([primary()]) }), ACTOR, {
      postMessageId: "900000000000000009",
      backupEligible: true,
    });
    for (const b of m.rows.flat().filter((b) => b.customId.startsWith("sp:"))) {
      expect(b.customId).toContain(`:${ACTOR}:`);
      expect(b.customId.endsWith(":900000000000000009")).toBe(true);
      expect(b.customId.length).toBeLessThanOrEqual(100);
    }
    for (const row of m.rows) expect(row.length).toBeLessThanOrEqual(5);
  });
});

describe("buildJoinChoice", () => {
  it("D&D offers the legacy Normal and Heroic categories", () => {
    const m = buildJoinChoice(view({}), ACTOR, {
      postMessageId: "900000000000000009",
    });
    expect(labels(m)).toEqual(["Join as Normal", "Join as Heroic"]);
    expect(m.rows[0][0].customId).toBe(
      `sp:pick:evt1:${ACTOR}:NORMAL:900000000000000009`,
    );
    expect(m.content).toMatch(/guests|preferences/i);
    expect(m.content).toMatch(/My signup/);
  });

  it("other systems offer one generic option", () => {
    const m = buildJoinChoice(
      view({ event: event({ gameSystem: "Daggerheart" }) }),
      ACTOR,
    );
    expect(labels(m)).toEqual(["Join"]);
    expect(m.rows[0][0].customId).toContain(":MIXED");
  });
});

describe("buildCancelConfirm", () => {
  it("is explicit about guests and offers a way back", () => {
    const m = buildCancelConfirm(
      view({ rsvp: rsvp([primary(), guest("g1", "Pat"), guest("g2", "Sam")]) }),
      ACTOR,
    );
    expect(m.content).toMatch(/also removes your 2 guests/);
    expect(labels(m)).toEqual(["Yes, cancel my signup", "Keep my signup"]);
    expect(ids(m)).toEqual(["sp:cancel_yes", "sp:keep"]);
  });
});

describe("buildRunTableMessage", () => {
  it("open and unregistered: points to the validated host form", () => {
    const m = buildRunTableMessage(view({}));
    expect(labels(m)).toEqual(["Open DM form"]);
    expect(ids(m)).toEqual(["host:evt1"]);
  });

  it("registered player must cancel first (explicit change-role, guests handled)", () => {
    const m = buildRunTableMessage(
      view({ rsvp: rsvp([primary(), guest("g1", "Pat")]) }),
    );
    expect(m.content).toMatch(/cancel your player signup/i);
    expect(m.content).toMatch(/guests/i);
    expect(ids(m)).toEqual(["my_signup:evt1"]);
  });

  it("an active GM is sent to edit their table", () => {
    const m = buildRunTableMessage(
      view({
        tables: [
          {
            id: "t1",
            title: "My Table",
            tableType: "NORMAL",
            softCap: 5,
            hardCap: 6,
            status: "OPEN",
            ambassadorProfile: { discordUserId: ACTOR, displayName: "Me" },
          },
        ],
      }),
    );
    expect(labels(m)).toEqual(["Edit table"]);
    expect(ids(m)).toEqual(["host:evt1"]);
  });

  it("closed events explain and offer nothing", () => {
    const m = buildRunTableMessage(
      view({ event: event({ status: "CANCELLED" }) }),
    );
    expect(m.content).toMatch(/cancelled/i);
    expect(m.rows).toEqual([]);
  });

  it("uses system host wording for non-D&D", () => {
    const m = buildRunTableMessage(
      view({ event: event({ gameSystem: "Daggerheart" }) }),
    );
    expect(labels(m)).toEqual(["Open GM form"]);
  });
});

describe("toDiscordRows", () => {
  it("maps descriptors onto discord.js action rows", () => {
    const m = buildSignupPanel(view({ rsvp: rsvp([primary()]) }), ACTOR);
    const rows = toDiscordRows(m.rows).map((r) => r.toJSON());
    expect(rows[0].components.map((c: any) => c.label)).toEqual(labels(m));
  });
});
