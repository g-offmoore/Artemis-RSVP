import { describe, expect, it } from "vitest";
import {
  eventCreateSchema,
  eventUpdateSchema,
  EventDateTimeInputError,
  guildSettingsUpdateSchema,
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

  it("rejects create schema with missing guildId", () => {
    const parsed = eventCreateSchema.safeParse({
      channelId: "channel",
      title: "Test",
      startAt: new Date(Date.now() + 3600_000),
      endAt: new Date(Date.now() + 7200_000),
      createdByDiscordId: "user",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("imageUrl validation", () => {
  const basePayload = {
    guildId: "guild",
    channelId: "channel",
    title: "Test Event",
    startAt: new Date(Date.now() + 3600_000),
    endAt: new Date(Date.now() + 7200_000),
    createdByDiscordId: "user",
  };

  it("accepts https image URL", () => {
    const parsed = eventCreateSchema.safeParse({
      ...basePayload,
      imageUrl: "https://example.com/poster.png",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts Discord CDN URL with query parameters", () => {
    const parsed = eventCreateSchema.safeParse({
      ...basePayload,
      imageUrl:
        "https://cdn.discordapp.com/attachments/123/456/event.webp?ex=abc&is=def&hm=xyz",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts missing imageUrl (optional field)", () => {
    const parsed = eventCreateSchema.safeParse(basePayload);
    expect(parsed.success).toBe(true);
  });

  it("rejects http imageUrl", () => {
    const parsed = eventCreateSchema.safeParse({
      ...basePayload,
      imageUrl: "http://example.com/poster.png",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects non-image extension", () => {
    const parsed = eventCreateSchema.safeParse({
      ...basePayload,
      imageUrl: "https://example.com/document.pdf",
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts null imageUrl in update schema (clears image)", () => {
    const parsed = eventUpdateSchema.safeParse({
      imageUrl: null,
      actorDiscordId: "user",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects http imageUrl in update schema", () => {
    const parsed = eventUpdateSchema.safeParse({
      imageUrl: "http://example.com/poster.png",
      actorDiscordId: "user",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("guildSettingsUpdateSchema", () => {
  it("accepts valid IANA timezone", () => {
    const parsed = guildSettingsUpdateSchema.safeParse({
      defaultTimezone: "America/Chicago",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects invalid timezone string", () => {
    const parsed = guildSettingsUpdateSchema.safeParse({
      defaultTimezone: "Bad/Zone",
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts empty patch (no-op)", () => {
    const parsed = guildSettingsUpdateSchema.safeParse({});
    expect(parsed.success).toBe(true);
  });
});
