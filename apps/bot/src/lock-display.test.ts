import {
  buildEventEmbed,
  type EventEmbedDescriptor,
  type EventPresentationInput,
} from "@artemis/domain/event-presentation";
import { eventEmbed as botEventEmbed } from "./event-post.js";
import { describe, expect, it } from "vitest";

describe("bot and API Discord lock display consistency", () => {
  it.each([
    [undefined, "2027-08-01T17:00:00Z"],
    [30, "2027-08-01T17:30:00Z"],
    [120, "2027-08-01T16:00:00Z"],
    [0, "2027-08-01T18:00:00Z"],
  ])(
    "renders policy %s as the same lock timestamp on both paths",
    async (offset, expected) => {
      // Load the real exported API adapter without making bot's tsc rootDir
      // include another application's source tree. No bot startup or VM copy.
      const apiModulePath = new URL(
        "../../api/src/events/discord-event-post.service.ts",
        import.meta.url,
      ).href;
      const { eventEmbed: apiEventEmbed } = (await import(apiModulePath)) as {
        eventEmbed: (event: EventPresentationInput) => EventEmbedDescriptor;
      };
      const event = {
        id: "evt",
        title: "Event",
        gameSystem: "D&D",
        status: "SCHEDULED",
        startAt: new Date("2027-08-01T18:00:00Z"),
        endAt: new Date("2027-08-01T22:00:00Z"),
        assignmentLockOffsetMinutes: offset,
        // An earlier actual lock must not make the policy timestamp look actual.
        assignmentLockedAt: "2027-08-01T15:00:00Z",
        participants: [],
        tables: [],
      };
      const api = apiEventEmbed(event);
      const bot = botEventEmbed({
        ...event,
        startAt: event.startAt.toISOString(),
        endAt: event.endAt.toISOString(),
      }).toJSON();
      const expectedValue = `Scheduled: <t:${new Date(expected).getTime() / 1000}:F>`;
      const shared = buildEventEmbed(event);
      expect(
        shared.fields.find((field) => field.name === "Assignment lock")?.value,
      ).toBe(expectedValue);
      expect(api).toEqual(shared);
      expect(bot).toEqual(shared);
      expect(
        api.fields.find(
          (field: { name: string }) => field.name === "Assignment lock",
        )?.value,
      ).toBe(expectedValue);
      expect(
        bot.fields?.find(
          (field: { name: string }) => field.name === "Assignment lock",
        )?.value,
      ).toBe(expectedValue);
    },
  );
});
