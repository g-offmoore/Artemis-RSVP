import { describe, expect, it } from "vitest";
import { ArtemisApiError } from "./api.js";
import {
  extractMemberRoleIds,
  memberDisplayName,
  userFacingError,
} from "./interaction-utils.js";

describe("extractMemberRoleIds", () => {
  it("reads API member role arrays and GuildMember role caches", () => {
    expect(extractMemberRoleIds({ roles: ["a", "b"] })).toEqual(["a", "b"]);
    expect(
      extractMemberRoleIds({
        roles: {
          cache: new Map([
            ["r1", {}],
            ["r2", {}],
          ]),
        },
      }),
    ).toEqual(["r1", "r2"]);
  });
  it("is empty for anything else", () => {
    for (const v of [null, undefined, "x", {}, { roles: null }]) {
      expect(extractMemberRoleIds(v)).toEqual([]);
    }
  });
});

describe("memberDisplayName", () => {
  it("prefers the guild display name, falls back to the username", () => {
    expect(
      memberDisplayName({
        member: { displayName: "Nick" },
        user: { username: "u" },
      }),
    ).toBe("Nick");
    expect(memberDisplayName({ member: null, user: { username: "u" } })).toBe(
      "u",
    );
  });
});

describe("userFacingError", () => {
  it("surfaces validation messages for 400/403/409 only", () => {
    const body = JSON.stringify({ message: "This event has been cancelled." });
    for (const status of [400, 403, 409]) {
      expect(userFacingError(new ArtemisApiError(status, body))).toBe(
        "This event has been cancelled.",
      );
    }
    expect(userFacingError(new ArtemisApiError(500, body))).toMatch(
      /could not complete/,
    );
    expect(userFacingError(new Error("secret stack"))).not.toMatch(/secret/);
  });
  it("keeps the RSVP-first hint for guests without an RSVP", () => {
    expect(userFacingError(new ArtemisApiError(404, "RSVP not found"))).toBe(
      "RSVP first, then add guests.",
    );
  });
});
