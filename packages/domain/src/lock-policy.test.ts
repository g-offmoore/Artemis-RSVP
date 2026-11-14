import { describe, expect, it } from "vitest";
import {
  computeAssignmentLockScheduledFor,
  assignmentLockOffsetMinutesSchema,
  eventCreateSchema,
  eventUpdateSchema,
} from "./index.js";
import {
  computeAssignmentLockScheduledFor as dependencyFreeCompute,
  isAssignmentLockOffsetMinutes,
} from "./assignment-lock-time.js";

const input = {
  guildId: "guild",
  channelId: "channel",
  title: "Event",
  createdByDiscordId: "organizer",
  startAt: "2027-08-01T18:00:00Z",
  endAt: "2027-08-01T22:00:00Z",
};

describe("assignment lock offset contract", () => {
  it("re-exports the canonical dependency-free helper and shares validation", () => {
    expect(computeAssignmentLockScheduledFor).toBe(dependencyFreeCompute);
    for (const value of [
      undefined,
      null,
      "60",
      -1,
      0,
      30,
      60,
      120,
      1.5,
      NaN,
      Infinity,
      2147483647,
      2147483648,
    ]) {
      expect(assignmentLockOffsetMinutesSchema.safeParse(value).success).toBe(
        isAssignmentLockOffsetMinutes(value),
      );
    }
    expect(
      dependencyFreeCompute(new Date(input.startAt), 2147483647).getTime(),
    ).toBe(new Date(input.startAt).getTime() - 2147483647 * 60000);
  });
  it("defaults only new events, leaving omitted PATCH fields untouched", () => {
    expect(eventCreateSchema.parse(input).assignmentLockOffsetMinutes).toBe(60);
    expect(
      eventUpdateSchema.parse({ actorDiscordId: "organizer" }),
    ).not.toHaveProperty("assignmentLockOffsetMinutes");
  });

  it.each([0, 30, 60, 120])(
    "preserves explicit offset %s through create and PATCH validation",
    (offset) => {
      expect(
        eventCreateSchema.parse({
          ...input,
          assignmentLockOffsetMinutes: offset,
        }).assignmentLockOffsetMinutes,
      ).toBe(offset);
      expect(
        eventUpdateSchema.parse({
          actorDiscordId: "organizer",
          assignmentLockOffsetMinutes: offset,
        }).assignmentLockOffsetMinutes,
      ).toBe(offset);
    },
  );

  it.each([-1, 1.5, NaN, Infinity, null, "60", 2147483648])(
    "rejects invalid explicit offset %s instead of defaulting",
    (offset) => {
      expect(() =>
        eventCreateSchema.parse({
          ...input,
          assignmentLockOffsetMinutes: offset,
        }),
      ).toThrow();
      expect(() =>
        eventUpdateSchema.parse({
          actorDiscordId: "organizer",
          assignmentLockOffsetMinutes: offset,
        }),
      ).toThrow();
      expect(() =>
        computeAssignmentLockScheduledFor(
          new Date(input.startAt),
          offset as number,
        ),
      ).toThrow();
    },
  );

  it("rejects invalid start instants", () => {
    expect(() => computeAssignmentLockScheduledFor(new Date(NaN))).toThrow();
  });
});
