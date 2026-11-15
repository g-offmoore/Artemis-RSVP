import { describe, expect, it } from "vitest";
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
  const PUBLIC_ROW = [
    ["join:evt1", "Join", 3],
    ["run_table:evt1", "Run a table", 1],
    ["my_signup:evt1", "My signup", 2],
  ];

  it("public controls are literally Join, Run a table, My signup", () => {
    expect(summary(baseEvent)).toEqual([PUBLIC_ROW]);
  });

  it("is identical for every game system and guest policy (details live in the ephemeral panel)", () => {
    expect(summary({ ...baseEvent, gameSystem: "Pathfinder" })).toEqual([
      PUBLIC_ROW,
    ]);
    expect(summary({ ...baseEvent, gameSystem: "Daggerheart" })).toEqual([
      PUBLIC_ROW,
    ]);
    expect(
      summary({ ...baseEvent, eventType: { allowsGuests: false } }),
    ).toEqual([PUBLIC_ROW]);
  });

  it("never exposes organizer actions, diagnostics or legacy action IDs", () => {
    const ids = buildEventButtonRows(baseEvent)
      .flat()
      .map((b) => b.customId.split(":")[0]);
    expect(ids).toEqual(["join", "run_table", "my_signup"]);
  });

  it("cancelled, completed, archived and draft events have no controls", () => {
    for (const status of ["CANCELLED", "COMPLETED", "ARCHIVED", "DRAFT"]) {
      expect(buildEventButtonRows({ ...baseEvent, status })).toEqual([]);
    }
  });

  it("closed/locked/in-progress events keep only My signup", () => {
    const onlyMine = [[["my_signup:evt1", "My signup", 2]]];
    for (const status of ["LOCKED", "SIGNUP_CLOSED", "IN_PROGRESS"]) {
      expect(summary({ ...baseEvent, status })).toEqual(onlyMine);
    }
    expect(
      summary({
        ...baseEvent,
        assignmentLockedAt: "2026-11-30T22:00:00.000Z",
      }),
    ).toEqual(onlyMine);
  });

  it("open statuses keep all three controls", () => {
    for (const status of ["SCHEDULED", "SIGNUP_OPEN", undefined, null]) {
      expect(summary({ ...baseEvent, status })).toEqual([PUBLIC_ROW]);
    }
  });

  it("respects Discord limits (<=5 buttons per row, <=100 char ids)", () => {
    for (const row of buildEventButtonRows(baseEvent)) {
      expect(row.length).toBeLessThanOrEqual(5);
      for (const b of row) expect(b.customId.length).toBeLessThanOrEqual(100);
    }
  });
});

describe("buildEventEmbed", () => {
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
