import { describe, expect, it, vi } from "vitest";
import { ForbiddenException } from "@nestjs/common";
import { EventsService } from "./events.service.js";

const ACTOR = "100000000000000001";
function setup(overrides: Record<string, unknown> = {}) {
  const event = {
    id: "evt1",
    guildId: "g1",
    status: "SIGNUP_OPEN",
    gameSystem: "D&D",
    assignmentLockedAt: null,
    signupOpensAt: null,
    signupClosesAt: null,
    eligibilityRules: [],
    eventType: { allowsGuests: true, maxGuestsPerRsvp: 3 },
    ...overrides,
  };
  const tx = {
    rSVP: {
      findUnique: vi.fn(async () => ({
        id: "r1",
        status: "CANCELLED",
        signupRole: "PLAYER",
      })),
      upsert: vi.fn(async () => ({ id: "r1" })),
    },
    playerProfile: { upsert: vi.fn(async () => ({ id: "p1" })) },
    eventParticipant: {
      upsert: vi.fn(async () => ({ id: "primary" })),
      findUnique: vi.fn(async () => null),
      deleteMany: vi.fn(),
    },
    eventTable: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: "table1" })),
    },
    auditLog: { create: vi.fn() },
  };
  const client = {
    ...tx,
    event: { findUnique: vi.fn(async () => event) },
    eventRole: { findUnique: vi.fn(async () => null) },
    eventSignupPreference: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({})),
      findUnique: vi.fn(async () => ({ eventId: "evt1", userId: ACTOR })),
      delete: vi.fn(async () => ({})),
    },
    rSVP: { ...tx.rSVP, update: vi.fn(async () => ({})) },
    ambassadorProfile: {
      upsert: vi.fn(async () => ({ id: "gm1", displayName: "Me" })),
    },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const noop = {} as never;
  return {
    service: new EventsService({ client } as never, noop, noop, noop, noop),
    client,
    tx,
  };
}
const body = {
  discordUserId: ACTOR,
  displayName: "Me",
  selectedCategory: "NORMAL",
};
const preference = {
  preferenceType: "AVOID_PLAYER",
  targetUserId: "200000000000000002",
};

describe("personal-panel API safety regressions", () => {
  it.each([
    { assignmentLockedAt: new Date() },
    { status: "LOCKED" },
    { status: "DRAFT" },
    { status: "SIGNUP_CLOSED" },
  ])(
    "refuses stale signup, guest and table mutations for %j",
    async (state) => {
      const { service, client } = setup(state);
      await expect(service.rsvp("evt1", body)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(
        service.createTable("evt1", { ambassadorDiscordId: ACTOR }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.updateGuests("evt1", ACTOR, { guests: [] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(client.$transaction).not.toHaveBeenCalled();
    },
  );
  it.each([
    { assignmentLockedAt: new Date() },
    { status: "LOCKED" },
    { status: "COMPLETED" },
    { status: "CANCELLED" },
    { status: "IN_PROGRESS" },
  ])("refuses preference writes and deletes for %j", async (state) => {
    const { service, client } = setup(state);
    await expect(
      service.upsertPreference("evt1", ACTOR, preference),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.deletePreference("pref1", ACTOR),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(client.eventSignupPreference.create).not.toHaveBeenCalled();
    expect(client.eventSignupPreference.delete).not.toHaveBeenCalled();
  });
  it.each(["CANCELLED", "COMPLETED", "ARCHIVED", "IN_PROGRESS"])(
    "refuses cancellation on %s events",
    async (status) => {
      const { service, client } = setup({ status });
      client.rSVP.findUnique.mockResolvedValue({
        id: "r1",
        status: "GOING",
        signupRole: "PLAYER",
      });
      await expect(service.cancelRsvp("evt1", ACTOR)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(client.rSVP.update).not.toHaveBeenCalled();
    },
  );
  it("reactivates only the primary on cancel/rejoin; old guests stay inactive", async () => {
    const { service, tx } = setup();
    await service.rsvp("evt1", body);
    expect(tx.eventParticipant.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          assignmentEligible: true,
          attendanceEligible: true,
        }),
      }),
    );
  });
  it("does not let an active table owner rejoin as player or backup via stale controls", async () => {
    for (const signupRole of ["PLAYER", "BACKUP_DM"]) {
      const { service, tx } = setup();
      tx.eventTable.findFirst.mockResolvedValue({ id: "table1" } as never);
      await expect(
        service.rsvp("evt1", { ...body, signupRole }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(tx.rSVP.upsert).not.toHaveBeenCalled();
    }
  });
  it("does not let a backup player create a table without explicit promotion/guest handling", async () => {
    const { service, client } = setup();
    client.rSVP.findUnique.mockResolvedValue({
      id: "r1",
      status: "GOING",
      signupRole: "BACKUP_DM",
    });
    await expect(
      service.createTable("evt1", { ambassadorDiscordId: ACTOR }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(client.ambassadorProfile.upsert).not.toHaveBeenCalled();
  });
  it("does not allow guests on a cancelled registration", async () => {
    const { service, client } = setup();
    await expect(
      service.updateGuests("evt1", ACTOR, { guests: [] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(client.$transaction).not.toHaveBeenCalled();
  });
});
