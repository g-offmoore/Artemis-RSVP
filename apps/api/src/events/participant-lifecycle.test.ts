import { describe, expect, it, vi } from "vitest";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { EventsService } from "./events.service.js";

// Regression tests for the participant-facing lifecycle guards exposed through
// the P01b panel. The panel hides controls, but API/domain must refuse the
// mutation on its own (rules.md 4.6, 6.4, 6.8, 6.9).

const ACTOR = "100000000000000001";

function setup(
  eventOverrides: Record<string, unknown> = {},
  rsvp: unknown = null,
) {
  const baseEvent = {
    id: "evt1",
    guildId: "g1",
    status: "SIGNUP_OPEN",
    gameSystem: "D&D",
    signupOpensAt: null,
    signupClosesAt: null,
    assignmentLockedAt: null,
    eventType: { allowsGuests: true, maxGuestsPerRsvp: 3 },
    eligibilityRules: [],
    ...eventOverrides,
  };
  const transaction = vi.fn(async () => ({ id: "r1" }));
  const rsvpUpdate = vi.fn(async () => ({ id: "r1", status: "CANCELLED" }));
  const prisma = {
    client: {
      event: { findUnique: vi.fn(async () => baseEvent) },
      rSVP: {
        findUnique: vi.fn(async () => rsvp),
        update: rsvpUpdate,
      },
      eventRole: { findUnique: vi.fn(async () => null) },
      ambassadorProfile: {
        upsert: vi.fn(async () => ({ id: "a1", displayName: "A" })),
      },
      $transaction: transaction,
    },
  };
  const noop = {} as never;
  const service = new EventsService(prisma as never, noop, noop, noop, noop);
  return { service, prisma, transaction, rsvpUpdate };
}

const rsvpBody = {
  discordUserId: ACTOR,
  displayName: "Me",
  selectedCategory: "NORMAL",
  source: "discord",
};
const tableBody = {
  ambassadorDiscordId: ACTOR,
  ambassadorDisplayName: "Me",
  tableType: "NORMAL",
  softCap: 5,
  hardCap: 6,
};

describe("participant mutations on ended or running events", () => {
  it.each(["COMPLETED", "ARCHIVED", "IN_PROGRESS"])(
    "rsvp is refused when the event is %s",
    async (status) => {
      const { service, transaction } = setup({ status });
      await expect(service.rsvp("evt1", rsvpBody)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(transaction).not.toHaveBeenCalled();
    },
  );

  it.each(["COMPLETED", "ARCHIVED", "IN_PROGRESS"])(
    "guest edits are refused when the event is %s",
    async (status) => {
      const { service, transaction } = setup({ status });
      await expect(
        service.updateGuests("evt1", ACTOR, {
          guests: [{ displayName: "Pat" }],
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(transaction).not.toHaveBeenCalled();
    },
  );

  it.each(["COMPLETED", "ARCHIVED", "IN_PROGRESS"])(
    "table signup is refused when the event is %s",
    async (status) => {
      const { service, prisma } = setup({ status });
      await expect(
        service.createTable("evt1", tableBody),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.client.ambassadorProfile.upsert).not.toHaveBeenCalled();
    },
  );

  it("rsvp still proceeds for an open event (existing behavior preserved)", async () => {
    const { service, transaction } = setup();
    await service.rsvp("evt1", rsvpBody);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});

describe("guest edits after assignments lock", () => {
  it("are refused by the API, not only hidden in the panel", async () => {
    const { service, transaction, prisma } = setup({
      assignmentLockedAt: new Date("2026-12-01T22:00:00.000Z"),
    });
    await expect(
      service.updateGuests("evt1", ACTOR, { guests: [{ displayName: "Pat" }] }),
    ).rejects.toThrow(/locked/i);
    expect(prisma.client.rSVP.findUnique).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("before lock they reach the RSVP lookup as before", async () => {
    const { service, prisma } = setup();
    await expect(
      service.updateGuests("evt1", ACTOR, { guests: [{ displayName: "Pat" }] }),
    ).rejects.toBeInstanceOf(NotFoundException); // no RSVP yet
    expect(prisma.client.rSVP.findUnique).toHaveBeenCalled();
  });
});

describe("cancelRsvp", () => {
  it("404s (not a database error) when the user has no RSVP", async () => {
    const { service, rsvpUpdate } = setup({}, null);
    await expect(service.cancelRsvp("evt1", ACTOR)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(rsvpUpdate).not.toHaveBeenCalled();
  });

  it("is idempotent for an already-cancelled RSVP (no second audit entry)", async () => {
    const existing = { id: "r1", status: "CANCELLED" };
    const { service, rsvpUpdate } = setup({}, existing);
    await expect(service.cancelRsvp("evt1", ACTOR)).resolves.toEqual(existing);
    expect(rsvpUpdate).not.toHaveBeenCalled();
  });

  it("cancels an active RSVP as before", async () => {
    const { service, rsvpUpdate } = setup({}, { id: "r1", status: "GOING" });
    await service.cancelRsvp("evt1", ACTOR);
    expect(rsvpUpdate).toHaveBeenCalledTimes(1);
  });
});
