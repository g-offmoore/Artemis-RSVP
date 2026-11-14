import { describe, expect, it } from "vitest";
import {
  buildEventButtonRows,
  buildEventEmbed,
} from "@artemis/domain/event-presentation";
import { eventButtons, eventEmbed, eventVocabulary } from "./event-post.js";

// Characterization of the CURRENT bot event post (pre-extraction behavior).
// Timestamps arrive as ISO strings because the bot reads events over JSON.
const baseEvent = {
  id: "evt1",
  title: "Game Night",
  description: null,
  imageUrl: null,
  gameSystem: "D&D",
  status: "SCHEDULED",
  startAt: "2026-12-01T00:00:00.000Z",
  endAt: "2026-12-01T03:00:00.000Z",
  eventType: { allowsGuests: true },
  tables: [
    { status: "OPEN", softCap: 4, hardCap: 6 },
    { status: "OPEN", softCap: 5, hardCap: 7 },
    { status: "CANCELLED", softCap: 9, hardCap: 9 },
  ],
  participants: [
    { participantType: "PRIMARY", assignmentEligible: true },
    { participantType: "PRIMARY", assignmentEligible: false },
    { participantType: "GUEST", assignmentEligible: true },
  ],
};

const rowSummary = (event: Parameters<typeof eventButtons>[0]) =>
  eventButtons(event).map((row) =>
    row.toJSON().components.map((c: any) => [c.custom_id, c.label, c.style]),
  );

describe("bot eventButtons (characterization)", () => {
  it("D&D: two category RSVPs, guests, host, assignment; second row fixed", () => {
    expect(rowSummary(baseEvent)).toEqual([
      [
        ["rsvp:evt1:NORMAL", "RSVP Normal", 3],
        ["rsvp:evt1:HEROIC", "RSVP Heroic", 1],
        ["guest:evt1", "Guests", 2],
        ["host:evt1", "DM Signup", 2],
        ["assignment:evt1", "My Assignment", 2],
      ],
      [
        ["backup_dm:evt1", "Backup DM Signup", 1],
        ["cancel_rsvp:evt1", "Cancel RSVP", 4],
        ["prefs:evt1", "Preferences", 2],
      ],
    ]);
  });

  it("non-D&D: single MIXED RSVP and system host label; guests removable", () => {
    const rows = rowSummary({
      ...baseEvent,
      gameSystem: "Daggerheart",
      eventType: { allowsGuests: false },
    });
    expect(rows[0]).toEqual([
      ["rsvp:evt1:MIXED", "RSVP", 3],
      ["host:evt1", "GM Signup", 2],
      ["assignment:evt1", "My Assignment", 2],
    ]);
    expect(rows[1]).toHaveLength(3);
  });

  it("missing eventType keeps the guest button", () => {
    const rows = rowSummary({ ...baseEvent, eventType: null });
    expect(rows[0].map((b: any) => b[0])).toContain("guest:evt1");
  });

  it("cancelled events render no rows", () => {
    expect(eventButtons({ ...baseEvent, status: "CANCELLED" })).toEqual([]);
  });
});

describe("bot eventEmbed (characterization)", () => {
  it("renders counts, capacity, timestamps and status", () => {
    const json = eventEmbed(baseEvent).toJSON();
    expect(json.title).toBe("Game Night");
    expect(json.description).toBe("Store event");
    expect(json.image).toBeUndefined();
    expect(json.fields).toEqual([
      {
        name: "When",
        value: "<t:1796083200:F> to <t:1796094000:t>\n<t:1796083200:R>",
      },
      {
        name: "Registered",
        value: "Players: 1\nGuests: 1\nDMs: 2",
        inline: true,
      },
      { name: "Capacity", value: "2/13 seats\n2 tables", inline: true },
      { name: "Status", value: "SCHEDULED", inline: true },
      { name: "Event ID", value: "evt1", inline: true },
    ]);
  });

  it("uses system vocabulary, image and the no-tables capacity text", () => {
    const json = eventEmbed({
      ...baseEvent,
      gameSystem: "Pathfinder",
      description: "Hello",
      imageUrl: "https://example.com/a.png",
      tables: [],
    }).toJSON();
    expect(json.description).toBe("Hello");
    expect(json.image).toEqual({ url: "https://example.com/a.png" });
    expect(json.fields?.[1].value).toBe(
      "Attendees: 1\nGuests: 1\nAmbassadors: 0",
    );
    expect(json.fields?.[2].value).toBe("No ambassador tables yet");
  });

  it("tolerates missing participants/tables arrays", () => {
    const json = eventEmbed({
      ...baseEvent,
      tables: undefined,
      participants: undefined,
    }).toJSON();
    expect(json.fields?.[1].value).toBe("Players: 0\nGuests: 0\nDMs: 0");
  });
});

describe("bot eventVocabulary (characterization)", () => {
  it.each([
    ["D&D", true, "DM"],
    [" dnd ", true, "DM"],
    ["Dungeons & Dragons 5e", true, "DM"],
    ["Daggerheart", false, "GM"],
    ["Pathfinder", false, "Ambassador"],
    ["", false, "Ambassador"],
  ])("%s", (gameSystem, dnd, host) => {
    const v = eventVocabulary({ gameSystem });
    expect(v.usesDndCategories).toBe(dnd);
    expect(v.hostSingular).toBe(host);
  });
  it("undefined game system falls back to Ambassador", () => {
    expect(eventVocabulary({}).hostSingular).toBe("Ambassador");
  });
});

describe("bot adapter parity with shared descriptors", () => {
  const matrix = [
    baseEvent,
    { ...baseEvent, gameSystem: "Daggerheart" },
    {
      ...baseEvent,
      gameSystem: "Pathfinder",
      eventType: { allowsGuests: false },
    },
    { ...baseEvent, status: "CANCELLED" },
    { ...baseEvent, imageUrl: "https://example.com/a.png", tables: [] },
  ];
  it.each(matrix.map((e, i) => [i, e] as const))("case %i", (_i, event) => {
    expect(eventEmbed(event).toJSON()).toEqual(buildEventEmbed(event));
    expect(
      eventButtons(event).map((r) =>
        r.toJSON().components.map((c: any) => ({
          customId: c.custom_id,
          label: c.label,
          style: c.style,
        })),
      ),
    ).toEqual(buildEventButtonRows(event));
  });
});
