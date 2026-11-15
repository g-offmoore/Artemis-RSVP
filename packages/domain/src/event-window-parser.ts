import { en } from "chrono-node";
import {
  createTimeZonePartsReader,
  formatUtcAsTimeZoneParts,
} from "./timezone-parts.js";

export type EventWindowErrorCode =
  | "INVALID_TEXT"
  | "UNSUPPORTED_INPUT"
  | "INVALID_DURATION"
  | "INVALID_TIMEZONE"
  | "EMBEDDED_TIMEZONE"
  | "START_NOT_FUTURE"
  | "INVALID_REFERENCE_NOW"
  | "OUT_OF_RANGE"
  | "NONEXISTENT_LOCAL_TIME"
  | "AMBIGUOUS_LOCAL_TIME";
export type EventWindowResult =
  | {
      ok: true;
      window: {
        startAt: Date;
        endAt: Date;
        timeZone: string;
        durationMinutes: number;
        durationSource: "default" | "text";
      };
    }
  | { ok: false; code: EventWindowErrorCode };

const minInstant = Date.parse("2000-01-01T00:00:00.000Z");
const maxInstant = Date.parse("2100-01-01T00:00:00.000Z");
const maxLookahead = 366 * 24 * 60 * 60_000;

const weekday =
  "(?:sun(?:day)?|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?)";
const calendarSyntax = new RegExp(
  `^(?:(?:next )?${weekday}|today|tomorrow|\\d{4}-\\d{2}-\\d{2}) (?:at )?(?:[1-9]|1[0-2])(?::[0-5]\\d)? ?(?:am|pm)$|^(?:(?:next )?${weekday}|today|tomorrow|\\d{4}-\\d{2}-\\d{2}) (?:at )?(?:[01]\\d|2[0-3]):[0-5]\\d$`,
);

/** Parser-only proposal. This does not authorize, persist, or publish an event. */
export function parseNaturalEventWindow(input: {
  text: string;
  timeZone: string;
  now: Date;
  defaultDurationMinutes?: number;
}): EventWindowResult {
  if (
    !(input.now instanceof Date) ||
    !Number.isFinite(input.now.getTime()) ||
    input.now.getTime() < minInstant ||
    input.now.getTime() >= maxInstant
  )
    return { ok: false, code: "INVALID_REFERENCE_NOW" };
  if (
    typeof input.timeZone !== "string" ||
    input.timeZone.length > 80 ||
    (input.timeZone !== "UTC" &&
      !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)+$/.test(input.timeZone))
  )
    return { ok: false, code: "INVALID_TIMEZONE" };
  try {
    createTimeZonePartsReader(input.timeZone);
  } catch {
    return { ok: false, code: "INVALID_TIMEZONE" };
  }
  if (
    typeof input.text !== "string" ||
    input.text.length > 256 ||
    !/^[\x20-\x7e]+$/.test(input.text) ||
    input.text.trim() === ""
  )
    return { ok: false, code: "INVALID_TEXT" };
  let text = input.text.trim().toLowerCase().replace(/ +/g, " ");
  // Embedded zones are never overrides, including a matching abbreviation.
  if (
    /\b(?:utc|gmt|[ecmp][ds]t)\b|[a-z_]+\/[a-z_]+|[+-]\d{2}:?\d{2}\b/.test(text)
  )
    return { ok: false, code: "EMBEDDED_TIMEZONE" };
  const fallback = input.defaultDurationMinutes ?? 240;
  const validDuration = (minutes: number) =>
    Number.isInteger(minutes) && minutes >= 30 && minutes <= 720;
  const suffix = / for (\d+) *(h|hours?|m|minutes?)$/.exec(text);
  const durationMinutes = suffix
    ? Number(suffix[1]) * (suffix[2].startsWith("h") ? 60 : 1)
    : fallback;
  if (
    !validDuration(fallback) ||
    !validDuration(durationMinutes) ||
    (text.includes(" for ") &&
      (!suffix || text.slice(0, suffix.index).includes(" for ")))
  )
    return { ok: false, code: "INVALID_DURATION" };
  if (suffix) text = text.slice(0, suffix.index);
  const relativeMatch = /^in ([1-9]\d*) (hours?|minutes?)$/.exec(text);
  const relative = relativeMatch !== null;
  if (
    relativeMatch &&
    Number(relativeMatch[1]) *
      (relativeMatch[2].startsWith("hour") ? 60 : 1) *
      60_000 >
      maxLookahead
  )
    return { ok: false, code: "OUT_OF_RANGE" };
  if (!relative && !calendarSyntax.test(text))
    return { ok: false, code: "UNSUPPORTED_INPUT" };
  const localNow = formatUtcAsTimeZoneParts(input.now, input.timeZone);
  // A UTC surrogate represents the reference's wall clock, not a real event instant.
  const reference = Date.UTC(
    localNow.year,
    localNow.month - 1,
    localNow.day,
    localNow.hour,
    localNow.minute,
  );
  const results = en.casual.parse(
    text,
    { instant: relative ? input.now : new Date(reference), timezone: 0 },
    { forwardDate: true },
  );
  const result = results[0];
  if (
    results.length !== 1 ||
    result.index !== 0 ||
    result.text !== text ||
    result.end
  )
    return { ok: false, code: "UNSUPPORTED_INPUT" };
  const parts = result.start;
  const desired = Date.UTC(
    parts.get("year")!,
    parts.get("month")! - 1,
    parts.get("day")!,
    parts.get("hour")!,
    parts.get("minute")!,
    relative ? parts.get("second")! : 0,
    relative ? parts.get("millisecond")! : 0,
  );
  let utc = desired;
  if (!relative) {
    const readParts = createTimeZonePartsReader(input.timeZone);
    const candidates: number[] = [];
    // All modern IANA offsets are whole minutes within +/-14 hours.
    // Enumerate offsets, not dates: at most 1681 exact round trips, no DST guess.
    for (let offset = -14 * 60; offset <= 14 * 60; offset += 1) {
      const candidate = desired - offset * 60_000;
      const actual = readParts(new Date(candidate));
      if (
        Date.UTC(
          actual.year,
          actual.month - 1,
          actual.day,
          actual.hour,
          actual.minute,
        ) === desired
      )
        candidates.push(candidate);
    }
    if (candidates.length === 0)
      return { ok: false, code: "NONEXISTENT_LOCAL_TIME" };
    if (candidates.length !== 1)
      return { ok: false, code: "AMBIGUOUS_LOCAL_TIME" };
    utc = candidates[0];
  }
  if (
    !Number.isFinite(utc) ||
    utc < minInstant ||
    utc + durationMinutes * 60_000 >= maxInstant ||
    utc - input.now.getTime() > maxLookahead
  )
    return { ok: false, code: "OUT_OF_RANGE" };
  if (utc <= input.now.getTime())
    return { ok: false, code: "START_NOT_FUTURE" };
  const startAt = new Date(utc);
  return {
    ok: true,
    window: {
      startAt,
      endAt: new Date(utc + durationMinutes * 60_000),
      timeZone: input.timeZone,
      durationMinutes,
      durationSource: suffix ? "text" : "default",
    },
  };
}
