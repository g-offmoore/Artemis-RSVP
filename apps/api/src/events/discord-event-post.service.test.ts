import { describe, expect, it } from "vitest";
import {
  buildEventButtonRows,
  buildEventEmbed,
} from "@artemis/domain/event-presentation";
import { eventButtons, eventEmbed } from "./discord-event-post.service.js";

// Characterization of the CURRENT API-published Discord post. The API reads
// Prisma rows, so timestamps are Date objects.
const baseEvent = {
  id: "evt1",
  title: "Game Night",
  description: null,
  imageUrl: null,
  gameSystem: "D&D",
  status: "SCHEDULED",
  startAt: new Date("2026-12-01T00:00:00.000Z"),
  endAt: new Date("2026-12-01T03:00:00.000Z"),
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
    row.components.map((c) => [c.custom_id, c.label, c.style]),
  );

describe("API eventButtons", () => {
  const PUBLIC_ROW = [
    ["join:evt1", "Join", 3],
    ["run_table:evt1", "Run a table", 1],
    ["my_signup:evt1", "My signup", 2],
  ];

  it("renders the literal public controls as one REST action row", () => {
    expect(rowSummary(baseEvent)).toEqual([PUBLIC_ROW]);
    expect(eventButtons(baseEvent).every((r) => r.type === 1)).toBe(true);
    expect(
      rowSummary({
        ...baseEvent,
        gameSystem: "Daggerheart",
        eventType: { allowsGuests: false },
      }),
    ).toEqual([PUBLIC_ROW]);
  });

  it("cancelled and completed events render nothing; locked keeps My signup", () => {
    expect(eventButtons({ ...baseEvent, status: "CANCELLED" })).toEqual([]);
    expect(eventButtons({ ...baseEvent, status: "COMPLETED" })).toEqual([]);
    expect(rowSummary({ ...baseEvent, status: "LOCKED" })).toEqual([
      [["my_signup:evt1", "My signup", 2]],
    ]);
  });
});

describe("API eventEmbed (characterization)", () => {
  it("renders counts, capacity, timestamps and status", () => {
    expect(eventEmbed(baseEvent)).toEqual({
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

  it("system vocabulary, image and no-tables text", () => {
    const embed = eventEmbed({
      ...baseEvent,
      gameSystem: "Pathfinder",
      description: "Hello",
      imageUrl: "https://example.com/a.png",
      tables: [],
    });
    expect(embed.description).toBe("Hello");
    expect(embed.image).toEqual({ url: "https://example.com/a.png" });
    expect(embed.fields[1].value).toBe(
      "Attendees: 1\nGuests: 1\nAmbassadors: 0",
    );
    expect(embed.fields[2].value).toBe("No ambassador tables yet");
  });
});

describe("API adapter parity with shared descriptors", () => {
  it("maps descriptors 1:1 onto REST components", () => {
    const events = [
      baseEvent,
      { ...baseEvent, gameSystem: "Pathfinder", eventType: null },
      { ...baseEvent, status: "CANCELLED" },
    ];
    for (const event of events) {
      expect(
        eventButtons(event).map((r) =>
          r.components.map((c) => ({
            customId: c.custom_id,
            label: c.label,
            style: c.style,
          })),
        ),
      ).toEqual(buildEventButtonRows(event));
      expect(eventEmbed(event)).toEqual(buildEventEmbed(event));
    }
  });
});
