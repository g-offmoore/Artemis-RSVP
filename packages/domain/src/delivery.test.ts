import { describe, expect, it } from "vitest";
import {
  assignmentDeliveryKey,
  classifyDeliveryError,
  computeDeliveryBackoffMs,
  DELIVERY_DEFAULTS,
  legacyDeliveryKey,
  nextDeliveryState,
  sanitizeDeliveryError,
  TerminalDeliveryError,
} from "./index.js";

const now = new Date("2026-11-21T12:00:00Z");

describe("delivery keys", () => {
  it("keeps the legacy event/type/target identity", () => {
    expect(legacyDeliveryKey("e1", "PREFLIGHT", "u1")).toBe("e1:PREFLIGHT:u1");
  });

  it("scopes assignment notices to one lock revision per user", () => {
    const a = assignmentDeliveryKey("e1", new Date(1000), "u1");
    expect(a).toBe(assignmentDeliveryKey("e1", new Date(1000), "u1"));
    expect(a).not.toBe(assignmentDeliveryKey("e1", new Date(2000), "u1"));
    expect(a).not.toBe(assignmentDeliveryKey("e1", new Date(1000), "u2"));
  });
});

describe("classifyDeliveryError", () => {
  it("treats closed DMs as terminal", () => {
    const err = new Error('Discord API 403 (/channels/1/messages): {"message":"Cannot send messages to this user","code":50007}');
    expect(classifyDeliveryError(err).kind).toBe("TERMINAL");
  });

  it("reads retry_after from a 429", () => {
    const err = new Error('Discord API 429 (/x): {"retry_after": 2.5, "global": false}');
    expect(classifyDeliveryError(err)).toMatchObject({ kind: "RATE_LIMITED", retryAfterMs: 2500 });
  });

  it("retries 5xx and network errors", () => {
    expect(classifyDeliveryError(new Error("Discord API 502 (/x): bad gateway")).kind).toBe("RETRYABLE");
    expect(classifyDeliveryError(new Error("fetch failed")).kind).toBe("RETRYABLE");
  });

  it("honors TerminalDeliveryError", () => {
    expect(classifyDeliveryError(new TerminalDeliveryError("Unknown messageType X")).kind).toBe("TERMINAL");
  });
});

describe("sanitizeDeliveryError", () => {
  it("redacts bot tokens", () => {
    const out = sanitizeDeliveryError("failed with Bot MTIzNDU2Nzg5MDEyMzQ1Njc4.abcdef.ghijklmnopqrstuvwxyz0123");
    expect(out).not.toContain("MTIzNDU2Nzg5MDEyMzQ1Njc4");
  });
});

describe("nextDeliveryState", () => {
  it("schedules a retry with bounded backoff", () => {
    const out = nextDeliveryState(1, 5, new Error("fetch failed"), now, () => 0.5);
    expect(out.status).toBe("PENDING");
    if (out.status !== "PENDING") return;
    const delay = out.nextAttemptAt.getTime() - now.getTime();
    expect(delay).toBeGreaterThanOrEqual(DELIVERY_DEFAULTS.baseBackoffMs / 2);
    expect(delay).toBeLessThanOrEqual(DELIVERY_DEFAULTS.maxBackoffMs);
  });

  it("uses Discord's retry_after for rate limits", () => {
    const out = nextDeliveryState(1, 5, new Error('Discord API 429 (/x): {"retry_after": 3}'), now);
    expect(out.status === "PENDING" && out.nextAttemptAt.getTime() - now.getTime()).toBe(3000);
  });

  it("fails after the last attempt", () => {
    expect(nextDeliveryState(5, 5, new Error("fetch failed"), now).status).toBe("FAILED");
  });

  it("fails immediately on terminal errors", () => {
    const err = new Error('Discord API 403 (/x): {"code":50007}');
    expect(nextDeliveryState(1, 5, err, now).status).toBe("FAILED");
  });
});

describe("computeDeliveryBackoffMs", () => {
  it("grows with attempts and never exceeds the cap", () => {
    expect(computeDeliveryBackoffMs(1, () => 1)).toBe(DELIVERY_DEFAULTS.baseBackoffMs);
    expect(computeDeliveryBackoffMs(3, () => 1)).toBe(4 * DELIVERY_DEFAULTS.baseBackoffMs);
    expect(computeDeliveryBackoffMs(30, () => 1)).toBe(DELIVERY_DEFAULTS.maxBackoffMs);
  });
});
