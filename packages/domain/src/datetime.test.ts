import { describe, expect, it } from "vitest";
import {
  eventCreateSchema,
  EventDateTimeInputError,
  parseEventDateTimeParts,
} from "./index.js";

describe("parseEventDateTimeParts", () => {
  it("parses store-local date and 24-hour time into UTC", () => {
    expect(parseEventDateTimeParts("2026-06-18", "1700").toISOString()).toBe(
      "2026-06-18T21:00:00.000Z",
    );
  });

  it("parses slash dates and 12-hour time", () => {
    expect(parseEventDateTimeParts("6/18/2026", "6:30 PM").toISOString()).toBe(
      "2026-06-18T22:30:00.000Z",
    );
  });

  it("rejects missing date context", () => {
    expect(() => parseEventDateTimeParts("1700", "1800")).toThrow(
      EventDateTimeInputError,
    );
  });

  it("rejects bare time-like strings as event datetimes", () => {
    const parsed = eventCreateSchema.safeParse({
      guildId: "guild",
      channelId: "channel",
      title: "Test",
      startAt: "1700",
      endAt: "1705",
      createdByDiscordId: "user",
    });

    expect(parsed.success).toBe(false);
  });
});
