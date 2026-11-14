import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
import {
  buildEventButtonRows,
  buildEventEmbed,
  resolveEventVocabulary,
  type EventPresentationInput,
} from "./event-presentation.js";

const baseEvent: EventPresentationInput = {
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
    { status: "COMPLETED", softCap: 9, hardCap: 9 },
  ],
  participants: [
    { participantType: "PRIMARY", assignmentEligible: true },
    { participantType: "PRIMARY", assignmentEligible: false },
    { participantType: "GUEST", assignmentEligible: true },
  ],
};

const summary = (event: EventPresentationInput) =>
  buildEventButtonRows(event).map((row) =>
    row.map((b) => [b.customId, b.label, b.style]),
  );

describe("resolveEventVocabulary", () => {
  it.each([
    ["D&D", "dnd"],
    [" dnd ", "dnd"],
    ["Dungeons & Dragons 5e", "dnd"],
    ["Daggerheart", "gm"],
    ["daggerheart", "gm"],
    ["Pathfinder", "ambassador"],
    ["", "ambassador"],
    [undefined, "ambassador"],
    [null, "ambassador"],
  ] as const)("%s -> %s", (gameSystem, kind) => {
    const v = resolveEventVocabulary(gameSystem);
    const expected = {
      dnd: {
        usesDndCategories: true,
        attendeePlural: "Players",
        hostSingular: "DM",
        hostPlural: "DMs",
        hostButtonLabel: "DM Signup",
      },
      gm: {
        usesDndCategories: false,
        attendeePlural: "Attendees",
        hostSingular: "GM",
        hostPlural: "GMs",
        hostButtonLabel: "GM Signup",
      },
      ambassador: {
        usesDndCategories: false,
        attendeePlural: "Attendees",
        hostSingular: "Ambassador",
        hostPlural: "Ambassadors",
        hostButtonLabel: "Ambassador Signup",
      },
    }[kind];
    expect(v).toEqual(expected);
  });
});

describe("buildEventButtonRows", () => {
  it("D&D keeps legacy custom IDs, labels, styles and order", () => {
    expect(summary(baseEvent)).toEqual([
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

  it("non-D&D uses one MIXED RSVP and the system host label", () => {
    expect(summary({ ...baseEvent, gameSystem: "Pathfinder" })[0]).toEqual([
      ["rsvp:evt1:MIXED", "RSVP", 3],
      ["guest:evt1", "Guests", 2],
      ["host:evt1", "Ambassador Signup", 2],
      ["assignment:evt1", "My Assignment", 2],
    ]);
  });

  it("allowsGuests=false removes only the guest button; null keeps it", () => {
    const ids = (e: EventPresentationInput) => summary(e)[0].map((b) => b[0]);
    expect(ids({ ...baseEvent, eventType: { allowsGuests: false } })).toEqual([
      "rsvp:evt1:NORMAL",
      "rsvp:evt1:HEROIC",
      "host:evt1",
      "assignment:evt1",
    ]);
    expect(ids({ ...baseEvent, eventType: null })).toContain("guest:evt1");
    expect(ids({ ...baseEvent, eventType: undefined })).toContain("guest:evt1");
  });

  it("cancelled events have no rows", () => {
    expect(buildEventButtonRows({ ...baseEvent, status: "CANCELLED" })).toEqual(
      [],
    );
  });

  it("respects Discord limits (<=5 buttons per row, <=100 char ids)", () => {
    for (const row of buildEventButtonRows(baseEvent)) {
      expect(row.length).toBeLessThanOrEqual(5);
      for (const b of row) expect(b.customId.length).toBeLessThanOrEqual(100);
    }
  });
});

describe("buildEventEmbed", () => {
  it("keeps the browser subpath dependency-free and outside the index cycle", () => {
    const visited = new Set<string>();
    const visit = (url: URL) => {
      expect(url.pathname).not.toMatch(/\/index\.ts$/);
      expect(visited.has(url.href)).toBe(false);
      visited.add(url.href);
      const source = readFileSync(url, "utf8");
      for (const entry of ts.preProcessFile(source).importedFiles) {
        expect(entry.fileName).toMatch(/^\.\//);
        visit(new URL(entry.fileName.replace(/\.js$/, ".ts"), url));
      }
    };
    visit(new URL("./event-presentation.ts", import.meta.url));
    expect(visited.size).toBe(2);
  });
  it("renders counts excluding ineligible participants and inactive tables", () => {
    expect(buildEventEmbed(baseEvent)).toEqual({
      title: "Game Night",
      description: "Store event",
      fields: [
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
        { name: "Assignment lock", value: "Scheduled: <t:1796079600:F>" },
      ],
    });
  });

  it("accepts Date and ISO string timestamps identically", () => {
    expect(
      buildEventEmbed({
        ...baseEvent,
        startAt: new Date("2026-12-01T00:00:00.000Z"),
        endAt: new Date("2026-12-01T03:00:00.000Z"),
      }),
    ).toEqual(buildEventEmbed(baseEvent));
  });

  it("non-D&D vocabulary, image, description and no-tables text", () => {
    const embed = buildEventEmbed({
      ...baseEvent,
      gameSystem: "Daggerheart",
      description: "Hello",
      imageUrl: "https://example.com/a.png",
      tables: [],
    });
    expect(embed.description).toBe("Hello");
    expect(embed.image).toEqual({ url: "https://example.com/a.png" });
    expect(embed.fields[1].value).toBe("Attendees: 1\nGuests: 1\nGMs: 0");
    expect(embed.fields[2].value).toBe("No gm tables yet");
  });

  it("tolerates missing tables/participants and defaults status", () => {
    const embed = buildEventEmbed({
      ...baseEvent,
      status: undefined,
      tables: undefined,
      participants: undefined,
    });
    expect(embed.fields[1].value).toBe("Players: 0\nGuests: 0\nDMs: 0");
    expect(embed.fields[3].value).toBe("SCHEDULED");
  });

  it("never exposes participant identities (privacy)", () => {
    const json = JSON.stringify(
      buildEventEmbed({
        ...baseEvent,
        participants: [
          {
            participantType: "PRIMARY",
            assignmentEligible: true,
            displayName: "Secret Person",
            discordUserId: "123456789",
          } as never,
        ],
      }),
    );
    expect(json).not.toContain("Secret Person");
    expect(json).not.toContain("123456789");
  });
});
