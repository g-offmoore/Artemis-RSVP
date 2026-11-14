import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageJobWorkerService } from "./message-job-worker.service.js";

// Tests the T-24h PREFLIGHT DM handler in isolation: Prisma and Discord are fully
// mocked so no DB or network is needed. dispatchJob/sendPreflightWarning are private,
// accessed via `as any` — an accepted pattern for unit-testing this worker's handlers.

function makeService(event: Record<string, unknown>) {
  const prisma = {
    client: {
      event: { findUnique: vi.fn().mockResolvedValue(event) },
    },
  };
  const service = new MessageJobWorkerService(
    {} as never, // JobsService — unused by dispatchJob
    {} as never, // MessageJobsService — unused by dispatchJob
    prisma as never,
    {} as never, // EventsService — unused by PREFLIGHT
    {} as never, // EventSeriesService — unused by PREFLIGHT
    {} as never, // DiscordRoleService — unused by PREFLIGHT
  );
  return service;
}

describe("MessageJobWorkerService PREFLIGHT dispatch", () => {
  const fetchMock = vi.fn();

  it.each(["PREFLIGHT", "REMINDER"])("%s displays the stored legacy lock time privately", async (messageType) => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ id: "dm-channel" }) })
      .mockResolvedValueOnce({ ok: true, text: async () => "{}" });
    vi.stubGlobal("fetch", fetchMock);
    const service = makeService({
      id: "evt-1", title: "Event", startAt: new Date("2027-08-01T18:00:00Z"),
      assignmentLockOffsetMinutes: 120, tables: [], participants: [], rsvps: [],
    });
    await (service as any).dispatchJob({ id: "job", eventId: "evt-1", targetId: "organizer", messageType }, "fake-token");
    const content = JSON.parse(fetchMock.mock.calls[1][1].body).content;
    expect(content).toContain(`<t:${new Date("2027-08-01T16:00:00Z").getTime() / 1000}:R>`);
    expect(content).not.toContain("T-1h");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).recipient_id).toBe("organizer");
  });

  it("does not record a false one-hour reason for automatic locks", async () => {
    const lockAssignments = vi.fn().mockRejectedValue(new Error("already locked"));
    const service = new MessageJobWorkerService({} as never, {} as never, {} as never,
      { lockAssignments } as never, {} as never, {} as never);
    await (service as any).dispatchJob({ id: "job", eventId: "evt-1", messageType: "ASSIGNMENT_LOCK" }, "fake-token");
    expect(lockAssignments.mock.calls[0][1].reason).not.toContain("T-1h");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("sends a private DM to the organizer with capacity/DM/guest warnings, and does not lock anything", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ id: "dm-channel-1" }) })
      .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({}) });
    vi.stubGlobal("fetch", fetchMock);

    const event = {
      id: "evt-1",
      title: "Thursday D&D",
      startAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      createdByDiscordId: "organizer-1",
      tables: [{ tableType: "HEROIC", ambassadorProfileId: "amb-1" }],
      participants: [
        { id: "p1", playerCategory: "NORMAL", participantType: "PRIMARY", assignments: [] },
        { id: "p2", playerCategory: "HEROIC", participantType: "PRIMARY", assignments: [{ eventParticipantId: "p2" }] },
        { id: "p3", playerCategory: "NORMAL", participantType: "GUEST", assignments: [] },
      ],
      rsvps: [{}],
    };

    const service = makeService(event);
    await (service as any).dispatchJob(
      { id: "job-1", messageType: "PREFLIGHT", targetId: "organizer-1", eventId: "evt-1" },
      "fake-token",
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // First call opens a DM channel with the organizer, not the public event channel.
    const [dmOpenUrl, dmOpenInit] = fetchMock.mock.calls[0];
    expect(dmOpenUrl).toContain("/users/@me/channels");
    expect(JSON.parse(dmOpenInit.body).recipient_id).toBe("organizer-1");

    const [, messageInit] = fetchMock.mock.calls[1];
    const content = JSON.parse(messageInit.body).content as string;
    expect(content).toContain("24-hour preflight");
    expect(content).toContain("NORMAL: 0 seated, 2 waitlisted"); // p1 + guest p3, no NORMAL table
    expect(content).toContain("⚠️ NO DM"); // NORMAL track has no table
    expect(content).toContain("Backup DMs available:** 1");
    expect(content).toContain("Guests:** 1 registered (1 currently waitlisted)");
    expect(content).toMatch(/private to you as the event organizer/i);
    expect(content).toMatch(/nothing is locked yet/i);
  });
});
