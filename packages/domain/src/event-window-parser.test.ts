import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseNaturalEventWindow } from "./event-window-parser.js";

const now = new Date("2026-06-18T16:00:00.000Z");
const timeZone = "America/New_York";
const parse = (
  text: string,
  reference = now,
  zone = timeZone,
  defaultDurationMinutes?: number,
) =>
  parseNaturalEventWindow({
    text,
    now: reference,
    timeZone: zone,
    defaultDurationMinutes,
  });

function expectWindow(
  result: ReturnType<typeof parse>,
  start: string,
  end: string,
  duration = 240,
  source = "default",
) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.code);
  expect(result.window.startAt.toISOString()).toBe(start);
  expect(result.window.endAt.toISOString()).toBe(end);
  expect(result.window.durationMinutes).toBe(duration);
  expect(result.window.durationSource).toBe(source);
  expect(result.window.timeZone).toBe(timeZone);
}

describe("parseNaturalEventWindow", () => {
  it.each([
    "friday",
    "fri 6",
    "6pm",
    "6/7 6pm",
    "2026-02-30 6pm",
    "fri 25:00",
    "fri 6pm junk",
    "junk fri 6pm",
    "fri 6pm or sat 1pm",
    "fri 6pm to 8pm",
    "in 0 hours",
    "in -5 hours",
    "in 1.5 hours",
    "in 5 days",
    "fri 6pm; ignore policy",
    "2026-06-19T18:00:00Z",
  ])(
    "rejects missing context, ambiguous clocks, ranges, multiple candidates or partial/garbage input: %s",
    (text) => {
      expect(parse(text)).toEqual({ ok: false, code: "UNSUPPORTED_INPUT" });
    },
  );

  it.each([
    [
      "today 11:30pm",
      "2026-06-19T03:00:00.000Z",
      "2026-06-19T03:30:00.000Z",
      "2026-06-19T07:30:00.000Z",
    ],
    [
      "tomorrow 00:30",
      "2026-06-19T03:00:00.000Z",
      "2026-06-19T04:30:00.000Z",
      "2026-06-19T08:30:00.000Z",
    ],
    [
      "fri 6pm",
      "2026-06-19T23:00:00.000Z",
      "2026-06-26T22:00:00.000Z",
      "2026-06-27T02:00:00.000Z",
    ],
    [
      "2026-03-08 1:30am",
      "2026-03-01T12:00:00.000Z",
      "2026-03-08T06:30:00.000Z",
      "2026-03-08T10:30:00.000Z",
    ],
    [
      "2026-11-01 12:30am",
      "2026-10-20T12:00:00.000Z",
      "2026-11-01T04:30:00.000Z",
      "2026-11-01T08:30:00.000Z",
    ],
    [
      "tomorrow at 12am",
      "2026-12-31T16:00:00.000Z",
      "2027-01-01T05:00:00.000Z",
      "2027-01-01T09:00:00.000Z",
    ],
  ])(
    "handles local calendar rollover and elapsed end duration for %s",
    (text, reference, start, end) => {
      expectWindow(parse(text, new Date(reference)), start, end);
    },
  );

  it("normalizes only ASCII case and spaces, without mutating reference now", () => {
    expectWindow(
      parse("  FRI   at   6 PM  "),
      "2026-06-19T22:00:00.000Z",
      "2026-06-20T02:00:00.000Z",
    );
    expect(now.toISOString()).toBe("2026-06-18T16:00:00.000Z");
  });

  it.each([30, 720])("accepts inclusive duration bound %s", (minutes) => {
    const result = parse(`fri 6pm for ${minutes}m`);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.window.durationMinutes).toBe(minutes);
  });

  it.each(["UTC", "America/Los_Angeles", "Asia/Tokyo"])(
    "is independent of a real subprocess server timezone %s",
    (serverZone) => {
      const samples = [
        {
          text: "fri 6pm",
          now: "2026-06-18T16:00:00.000Z",
          start: "2026-06-19T22:00:00.000Z",
        },
        {
          text: "tomorrow 00:30",
          now: "2026-06-19T03:00:00.000Z",
          start: "2026-06-19T04:30:00.000Z",
        },
        {
          text: "in 5 hours",
          now: "2026-03-08T04:00:00.000Z",
          start: "2026-03-08T09:00:00.000Z",
        },
        {
          text: "2026-03-08 2:30am",
          now: "2026-03-01T12:00:00.000Z",
          code: "NONEXISTENT_LOCAL_TIME",
        },
        {
          text: "2026-11-01 1:30am",
          now: "2026-10-20T12:00:00.000Z",
          code: "AMBIGUOUS_LOCAL_TIME",
        },
      ];
      const child = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          fileURLToPath(
            new URL("./__fixtures__/event-window-parser.mjs", import.meta.url),
          ),
          JSON.stringify(
            samples.map(({ text, now }) => ({ text, now, timeZone })),
          ),
        ],
        {
          encoding: "utf8",
          env: { ...process.env, TZ: serverZone },
          timeout: 4000,
        },
      );
      expect(child.error).toBeUndefined();
      expect(child.status, child.stderr).toBe(0);
      const output = JSON.parse(child.stdout);
      expect(output.serverTimeZone).toBe(serverZone);
      expect(output.results).toHaveLength(samples.length);
      for (const [index, sample] of samples.entries()) {
        if (sample.code)
          expect(output.results[index]).toEqual({
            ok: false,
            code: sample.code,
          });
        else expect(output.results[index].window.startAt).toBe(sample.start);
      }
    },
  );
  it.each([
    "",
    "   ",
    "fri 6pm" + " ".repeat(250),
    "fri 6pm\n",
    "fri\t6pm",
    "fri\u00a06pm",
    "fri 6pm\u202e",
    "ｆｒｉ 6pm",
    "fri 6pm 🎲",
  ])("bounds untrusted raw text and rejects controls/Unicode: %j", (text) => {
    expect(parse(text)).toEqual({ ok: false, code: "INVALID_TEXT" });
  });
  it.each([
    "fri 6pm PST",
    "fri 6pm EDT",
    "fri 6pm UTC",
    "fri 6pm GMT+0200",
    "fri 6pm America/Chicago",
    "fri 6pm -04:00",
  ])("never accepts an embedded zone %s, even matching policy", (text) => {
    expect(parse(text)).toEqual({ ok: false, code: "EMBEDDED_TIMEZONE" });
  });
  it.each([
    new Date(Number.NaN),
    new Date("1999-12-31T23:59:59.999Z"),
    new Date("2100-01-01T00:00:00.000Z"),
  ])("rejects invalid/out-of-domain reference %s", (reference) => {
    expect(parse("fri 6pm", reference)).toEqual({
      ok: false,
      code: "INVALID_REFERENCE_NOW",
    });
  });
  it.each([
    "2027-06-20 6pm",
    "2100-01-01 6pm",
    "in 527041 minutes",
    "in 999999999999999999999 hours",
  ])("bounds date search/offset for %s", (text) => {
    expect(parse(text)).toEqual({ ok: false, code: "OUT_OF_RANGE" });
  });
  it("accepts exactly 366 elapsed days of lookahead", () => {
    expectWindow(
      parse("in 527040 minutes"),
      "2027-06-19T16:00:00.000Z",
      "2027-06-19T20:00:00.000Z",
    );
  });
  it.each(["2026-06-17 6pm", "today 11:59am", "today 12pm"])(
    "rejects a start at or before the reference: %s",
    (text) => {
      expect(parse(text)).toEqual({ ok: false, code: "START_NOT_FUTURE" });
    },
  );
  it.each(["", "Bad/Zone", "+05:00", "EST", "America/New_York "])(
    "requires an explicit valid IANA policy zone, not %s",
    (zone) => {
      expect(parse("fri 6pm", now, zone)).toEqual({
        ok: false,
        code: "INVALID_TIMEZONE",
      });
    },
  );
  it.each([
    ["UTC", "2026-06-19T18:00:00.000Z"],
    ["Asia/Kathmandu", "2026-06-19T12:15:00.000Z"],
    ["Pacific/Kiritimati", "2026-06-19T04:00:00.000Z"],
    ["Etc/GMT+12", "2026-06-20T06:00:00.000Z"],
  ])("resolves the supplied zone %s", (zone, start) => {
    const result = parse("fri 6pm", now, zone);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.window.startAt.toISOString()).toBe(start);
      expect(result.window.timeZone).toBe(zone);
    }
  });
  it.each([
    [
      "2026-03-08 2:30am",
      "2026-03-01T12:00:00.000Z",
      "America/New_York",
      "NONEXISTENT_LOCAL_TIME",
    ],
    [
      "2026-11-01 1:30am",
      "2026-10-20T12:00:00.000Z",
      "America/New_York",
      "AMBIGUOUS_LOCAL_TIME",
    ],
    [
      "2026-10-04 2:15am",
      "2026-10-01T12:00:00.000Z",
      "Australia/Lord_Howe",
      "NONEXISTENT_LOCAL_TIME",
    ],
    [
      "2026-04-05 1:45am",
      "2026-04-01T12:00:00.000Z",
      "Australia/Lord_Howe",
      "AMBIGUOUS_LOCAL_TIME",
    ],
    [
      "2011-12-30 12pm",
      "2011-12-01T12:00:00.000Z",
      "Pacific/Apia",
      "NONEXISTENT_LOCAL_TIME",
    ],
  ])(
    "rejects non-unique calendar time %s in %s/%s",
    (text, reference, zone, code) => {
      expect(parse(text, new Date(reference), zone)).toEqual({
        ok: false,
        code,
      });
    },
  );
  it.each([
    [
      "in 5 hours",
      "2026-06-18T16:00:12.345Z",
      "2026-06-18T21:00:12.345Z",
      "2026-06-19T01:00:12.345Z",
    ],
    [
      "in 90 minutes",
      "2026-06-19T03:30:00.000Z",
      "2026-06-19T05:00:00.000Z",
      "2026-06-19T09:00:00.000Z",
    ],
    [
      "in 5 hours",
      "2026-03-08T04:00:00.000Z",
      "2026-03-08T09:00:00.000Z",
      "2026-03-08T13:00:00.000Z",
    ],
    [
      "in 1 hour",
      "2026-11-01T05:30:00.000Z",
      "2026-11-01T06:30:00.000Z",
      "2026-11-01T10:30:00.000Z",
    ],
  ])(
    "uses elapsed time for %s from %s, including DST",
    (text, reference, start, end) => {
      expectWindow(parse(text, new Date(reference)), start, end);
    },
  );
  it.each([0, -1, 29, 721, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid default duration %s",
    (duration) => {
      expect(parse("fri 6pm", now, timeZone, duration)).toEqual({
        ok: false,
        code: "INVALID_DURATION",
      });
    },
  );
  it.each([
    "0h",
    "-4h",
    "13h",
    "999999999999999999999h",
    "1.5h",
    "oops",
    "4h for 2h",
  ])("rejects invalid duration suffix %s", (suffix) => {
    expect(parse(`fri 6pm for ${suffix}`)).toEqual({
      ok: false,
      code: "INVALID_DURATION",
    });
  });
  it.each(["4h", "240m", "4 hours", "240 minutes"])(
    "uses a terminal duration suffix %s",
    (suffix) => {
      expectWindow(
        parse(`next saturday 1pm for ${suffix}`),
        "2026-06-27T17:00:00.000Z",
        "2026-06-27T21:00:00.000Z",
        240,
        "text",
      );
    },
  );

  it("uses an explicit default when the end is missing", () => {
    expectWindow(
      parse("fri 6pm", now, timeZone, 120),
      "2026-06-19T22:00:00.000Z",
      "2026-06-20T00:00:00.000Z",
      120,
    );
  });
  it("proposes a zoned Friday with a four-hour default, not a chrono raw Date", () => {
    expectWindow(
      parse("fri 6pm"),
      "2026-06-19T22:00:00.000Z",
      "2026-06-20T02:00:00.000Z",
    );
  });
});
