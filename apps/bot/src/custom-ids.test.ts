import { describe, expect, it } from "vitest";
import {
  buildPanelCustomId,
  parseButtonCustomId,
  STALE_BUTTON_MESSAGE,
} from "./custom-ids.js";

const ACTOR = "100000000000000001";
const EVT = "cmeventid0000000000000001";

describe("parseButtonCustomId: new public controls", () => {
  it.each([
    ["join", "join"],
    ["run_table", "run_table"],
    ["my_signup", "my_signup"],
  ])("%s:<eventId>", (prefix, kind) => {
    expect(parseButtonCustomId(`${prefix}:${EVT}`)).toEqual({
      kind,
      eventId: EVT,
    });
  });
});

describe("parseButtonCustomId: legacy IDs on already-posted messages keep routing", () => {
  it.each([
    [`rsvp:${EVT}:NORMAL`, { action: "rsvp", category: "NORMAL" }],
    [`rsvp:${EVT}:HEROIC`, { action: "rsvp", category: "HEROIC" }],
    [`rsvp:${EVT}:MIXED`, { action: "rsvp", category: "MIXED" }],
    [`rsvp:${EVT}`, { action: "rsvp" }],
    [`guest:${EVT}`, { action: "guest" }],
    [`guest_text:${EVT}`, { action: "guest_text" }],
    [`host:${EVT}`, { action: "host" }],
    [`dm:${EVT}`, { action: "dm" }],
    [`prefs:${EVT}`, { action: "prefs" }],
    [`cancel_rsvp:${EVT}`, { action: "cancel_rsvp" }],
    [`backup_dm:${EVT}`, { action: "backup_dm" }],
    [`assignment:${EVT}`, { action: "assignment" }],
  ])("%s", (customId, expected) => {
    expect(parseButtonCustomId(customId)).toEqual({
      kind: "legacy",
      eventId: EVT,
      ...expected,
    });
  });

  it("backup DM accept/decline DM buttons still route", () => {
    expect(parseButtonCustomId(`backupdm:accept:${EVT}:part1`)).toEqual({
      kind: "backup_dm_response",
    });
    expect(parseButtonCustomId(`backupdm:decline:${EVT}:part1`)).toEqual({
      kind: "backup_dm_response",
    });
  });
});

describe("panel custom IDs are actor-bound", () => {
  it("round-trips every action with actor, category and public post hint", () => {
    for (const action of [
      "pick",
      "cancel",
      "cancel_yes",
      "keep",
      "backup",
      "refresh",
    ] as const) {
      const id = buildPanelCustomId(action, EVT, ACTOR, {
        category: action === "pick" ? "HEROIC" : undefined,
        postMessageId: "900000000000000009",
      });
      expect(id.length).toBeLessThanOrEqual(100);
      expect(parseButtonCustomId(id)).toEqual({
        kind: "panel",
        action,
        eventId: EVT,
        actorId: ACTOR,
        category: action === "pick" ? "HEROIC" : undefined,
        postMessageId: "900000000000000009",
      });
    }
  });

  it("works without optional category/post hint", () => {
    expect(
      parseButtonCustomId(buildPanelCustomId("refresh", EVT, ACTOR)),
    ).toEqual({
      kind: "panel",
      action: "refresh",
      eventId: EVT,
      actorId: ACTOR,
      category: undefined,
      postMessageId: undefined,
    });
  });

  it("a pick without a category is not a valid route", () => {
    expect(parseButtonCustomId(`sp:pick:${EVT}:${ACTOR}:-`)).toBeNull();
  });
});

describe("stale / invalid custom IDs fail safe", () => {
  it.each([
    "",
    "nonsense",
    "join:",
    "join",
    ":evt",
    "sp:unknown:evt:100000000000000001",
    "sp:cancel:evt",
    "sp:cancel:evt:not-a-snowflake",
    "totally:unknown:1",
    "guest-select:evt:msg", // user-select ids are routed elsewhere
  ])("%j -> null", (customId) => {
    expect(parseButtonCustomId(customId)).toBeNull();
  });

  it("has a user-facing stale message pointing at the post", () => {
    expect(STALE_BUTTON_MESSAGE).toMatch(/My signup/);
  });
});
