import { describe, expect, it, vi } from "vitest";
import { MessageFlags } from "discord.js";
import {
  buildMySignupView,
  type MySignupSource,
  type MySignupView,
} from "@artemis/domain";
import { ArtemisApiError } from "./api.js";
import { buildPanelCustomId, parseButtonCustomId } from "./custom-ids.js";
import {
  handleJoin,
  handleMySignup,
  handlePanelAction,
  handleRunTable,
  type PanelApi,
  type PanelInteraction,
} from "./panel-handlers.js";

const ACTOR = "100000000000000001";
const INTRUDER = "100000000000000999";
const EVT = "evt1";
const POST = "900000000000000009";

// A tiny stateful world behind a fake API. The view returned to the handlers is
// produced by the REAL buildMySignupView so handler tests exercise real
// view -> action decisions rather than canned flags.
type World = {
  eventOverrides: Record<string, unknown>;
  rsvp: null | {
    status: string;
    signupRole: string;
    selectedCategory: string;
    guests: string[];
    backupDmStatus: string | null;
  };
  tables: MySignupSource["tables"];
  eligible: boolean;
};

function makeHarness(partial: Partial<World> = {}) {
  const world: World = {
    eventOverrides: {},
    rsvp: null,
    tables: [],
    eligible: true,
    ...partial,
  };
  const calls: string[] = [];
  const log: Array<{ name: string; args: unknown[] }> = [];

  const viewFor = (actor: string): MySignupView => {
    const r = world.rsvp;
    const source: MySignupSource = {
      event: {
        id: EVT,
        title: "Game Night",
        status: "SIGNUP_OPEN",
        gameSystem: "D&D",
        startAt: "2026-12-01T23:00:00.000Z",
        signupOpensAt: null,
        signupClosesAt: null,
        assignmentLockedAt: null,
        eventType: { allowsGuests: true, maxGuestsPerRsvp: 3 },
        ...world.eventOverrides,
      } as MySignupSource["event"],
      rsvp: r
        ? {
            primaryDiscordUserId: ACTOR,
            status: r.status,
            signupRole: r.signupRole,
            selectedCategory: r.selectedCategory,
            participants: [
              {
                id: `${EVT}:${ACTOR}:primary`,
                participantType: "PRIMARY",
                discordUserId: ACTOR,
                displayName: "Me",
                signupRole: r.signupRole,
                backupDmStatus: r.backupDmStatus,
                assignmentEligible: true,
                assignments: [],
              },
              ...r.guests.map((name, i) => ({
                id: `g${i}`,
                participantType: "GUEST",
                displayName: name,
                assignmentEligible: true,
                partyOwnerParticipantId: `${EVT}:${ACTOR}:primary`,
                assignments: [],
              })),
            ],
          }
        : null,
      tables: world.tables,
    };
    return buildMySignupView(
      source,
      actor,
      new Date("2026-11-20T12:00:00.000Z"),
    );
  };

  const api: PanelApi = {
    getMySignup: vi.fn(async (eventId: string, actor: string) => {
      calls.push("api.getMySignup");
      log.push({ name: "getMySignup", args: [eventId, actor] });
      return viewFor(actor);
    }),
    rsvp: vi.fn(async (eventId: string, payload: any) => {
      calls.push("api.rsvp");
      log.push({ name: "rsvp", args: [eventId, payload] });
      world.rsvp = {
        status: "GOING",
        signupRole: payload.signupRole ?? "PLAYER",
        selectedCategory: payload.selectedCategory,
        guests: world.rsvp?.guests ?? [],
        backupDmStatus:
          payload.signupRole === "BACKUP_DM"
            ? "BACKUP_AVAILABLE_AS_PLAYER"
            : null,
      };
      return {};
    }),
    cancelRsvp: vi.fn(async (eventId: string, userId: string) => {
      calls.push("api.cancelRsvp");
      log.push({ name: "cancelRsvp", args: [eventId, userId] });
      if (world.rsvp) world.rsvp.status = "CANCELLED";
      return {};
    }),
    checkEligibility: vi.fn(async (_eventId: string, payload: any) => {
      calls.push("api.checkEligibility");
      log.push({ name: "checkEligibility", args: [payload] });
      return world.eligible
        ? { eligible: true }
        : {
            eligible: false,
            reason: "You are not eligible for this signup option.",
          };
    }),
  };
  const refreshPublicPost = vi.fn(
    async (_eventId: string, _source: unknown) => {
      calls.push("refreshPublicPost");
    },
  );
  return {
    world,
    api,
    calls,
    log,
    deps: { api, refreshPublicPost },
    refreshPublicPost,
  };
}

function makeInteraction(
  calls: string[],
  options: {
    userId?: string;
    customId?: string;
    ephemeralMessage?: boolean;
  } = {},
) {
  const replies: any[] = [];
  const interaction = {
    user: { id: options.userId ?? ACTOR, username: "me_user" },
    member: { displayName: "Me", roles: ["role-1", "role-2"] },
    customId: options.customId ?? "",
    channelId: "chan1",
    message: {
      id: options.ephemeralMessage ? "ephemeral-1" : POST,
      channelId: "chan1",
      flags: {
        has: (f: number) =>
          Boolean(options.ephemeralMessage) && f === MessageFlags.Ephemeral,
      },
    },
    deferReply: vi.fn(async (o: unknown) => {
      calls.push("interaction.deferReply");
      replies.push({ kind: "defer", o });
    }),
    deferUpdate: vi.fn(async () => {
      calls.push("interaction.deferUpdate");
    }),
    reply: vi.fn(async (p: any) => {
      calls.push("interaction.reply");
      replies.push({ kind: "reply", p });
    }),
    editReply: vi.fn(async (p: any) => {
      calls.push("interaction.editReply");
      replies.push({ kind: "edit", p });
    }),
  };
  const last = () => replies.filter((r) => r.kind === "edit").at(-1)?.p;
  const text = () => last()?.content as string;
  const buttons = () =>
    (last()?.components ?? []).flatMap((row: any) =>
      row
        .toJSON()
        .components.map((c: any) => ({ id: c.custom_id, label: c.label })),
    ) as Array<{ id: string; label: string }>;
  return {
    interaction: interaction as unknown as PanelInteraction,
    raw: interaction,
    last,
    text,
    buttons,
    replies,
  };
}

const route = (action: string, extra: Record<string, string> = {}) =>
  parseButtonCustomId(
    buildPanelCustomId(action as never, EVT, ACTOR, {
      postMessageId: POST,
      ...extra,
    }),
  ) as Extract<
    NonNullable<ReturnType<typeof parseButtonCustomId>>,
    { kind: "panel" }
  >;

describe("handleJoin", () => {
  it("defers ephemerally BEFORE any network call, then offers legacy categories", async () => {
    const h = makeHarness();
    const i = makeInteraction(h.calls);
    await handleJoin(i.interaction, EVT, h.deps);

    expect(h.calls.slice(0, 2)).toEqual([
      "interaction.deferReply",
      "api.getMySignup",
    ]);
    expect(i.raw.deferReply).toHaveBeenCalledWith({
      flags: MessageFlags.Ephemeral,
    });
    expect(i.buttons().map((b) => b.label)).toEqual([
      "Join as Normal",
      "Join as Heroic",
    ]);
    expect(h.api.rsvp).not.toHaveBeenCalled();
  });

  it("derives the actor from interaction.user.id", async () => {
    const h = makeHarness();
    const i = makeInteraction(h.calls, { userId: ACTOR });
    await handleJoin(i.interaction, EVT, h.deps);
    expect(h.log.find((l) => l.name === "getMySignup")!.args).toEqual([
      EVT,
      ACTOR,
    ]);
  });

  it("generic systems get a single Join choice", async () => {
    const h = makeHarness({ eventOverrides: { gameSystem: "Daggerheart" } });
    const i = makeInteraction(h.calls);
    await handleJoin(i.interaction, EVT, h.deps);
    expect(i.buttons().map((b) => b.label)).toEqual(["Join"]);
  });

  it("an already registered user sees their panel and is never re-registered", async () => {
    const h = makeHarness({
      world: undefined,
      rsvp: {
        status: "GOING",
        signupRole: "PLAYER",
        selectedCategory: "NORMAL",
        guests: [],
        backupDmStatus: null,
      },
    } as never);
    const i = makeInteraction(h.calls);
    await handleJoin(i.interaction, EVT, h.deps);
    expect(i.text()).toMatch(/already signed up|signed up as a player/i);
    expect(h.api.rsvp).not.toHaveBeenCalled();
  });

  it("closed events explain instead of offering Join", async () => {
    const h = makeHarness({ eventOverrides: { status: "CANCELLED" } });
    const i = makeInteraction(h.calls);
    await handleJoin(i.interaction, EVT, h.deps);
    expect(i.text()).toMatch(/cancelled/i);
    expect(i.buttons()).toEqual([]);
    expect(h.api.rsvp).not.toHaveBeenCalled();
  });

  it("carries the public post id from a public click, not from an ephemeral panel", async () => {
    const h1 = makeHarness();
    const pub = makeInteraction(h1.calls);
    await handleJoin(pub.interaction, EVT, h1.deps);
    expect(pub.buttons()[0].id.endsWith(`:${POST}`)).toBe(true);

    const h2 = makeHarness();
    const eph = makeInteraction(h2.calls, { ephemeralMessage: true });
    await handleJoin(eph.interaction, EVT, h2.deps);
    expect(eph.buttons()[0].id.endsWith(`:${POST}`)).toBe(false);
  });

  it("answers an unknown event privately", async () => {
    const h = makeHarness();
    (h.api.getMySignup as any).mockRejectedValueOnce(
      new ArtemisApiError(404, "{}"),
    );
    const i = makeInteraction(h.calls);
    await handleJoin(i.interaction, EVT, h.deps);
    expect(i.text()).toMatch(/couldn't find|could not find/i);
  });

  it("rethrows unexpected server errors so the global handler alerts ops", async () => {
    const h = makeHarness();
    (h.api.getMySignup as any).mockRejectedValueOnce(
      new ArtemisApiError(500, "boom"),
    );
    const i = makeInteraction(h.calls);
    await expect(handleJoin(i.interaction, EVT, h.deps)).rejects.toBeInstanceOf(
      ArtemisApiError,
    );
  });
});

describe("handlePanelAction: pick (join)", () => {
  it("registers via the existing RSVP mutation, shows the panel, refreshes the public post", async () => {
    const h = makeHarness();
    const i = makeInteraction(h.calls, { ephemeralMessage: true });
    await handlePanelAction(
      i.interaction,
      route("pick", { category: "HEROIC" }),
      h.deps,
    );

    expect(h.calls[0]).toBe("interaction.deferUpdate");
    const rsvp = h.log.find((l) => l.name === "rsvp")!;
    expect(rsvp.args[0]).toBe(EVT);
    expect(rsvp.args[1]).toEqual({
      discordUserId: ACTOR,
      displayName: "Me",
      selectedCategory: "HEROIC",
      source: "discord",
      memberDiscordRoleIds: ["role-1", "role-2"],
    });
    expect(i.text()).toMatch(/signed up as a player \(Heroic\)/);
    expect(i.text()).toMatch(/^You're signed up/);
    expect(i.buttons().map((b) => b.label)).toContain("Guests");
    expect(h.refreshPublicPost).toHaveBeenCalledWith(
      EVT,
      expect.objectContaining({
        hintedMessageId: POST,
        channelId: "chan1",
        sourceIsEphemeral: true,
      }),
    );
    // never edits the ephemeral panel as if it were the public post
    expect(h.calls.indexOf("api.rsvp")).toBeLessThan(
      h.calls.indexOf("refreshPublicPost"),
    );
  });

  it("a forged category is rejected without calling the API", async () => {
    const h = makeHarness({ eventOverrides: { gameSystem: "Daggerheart" } });
    const i = makeInteraction(h.calls, { ephemeralMessage: true });
    await handlePanelAction(
      i.interaction,
      route("pick", { category: "HEROIC" }),
      h.deps,
    );
    expect(h.api.rsvp).not.toHaveBeenCalled();
    expect(i.text()).toMatch(/no longer available/i);
  });

  it("a stale pick after the event closed does not register", async () => {
    const h = makeHarness({
      eventOverrides: { assignmentLockedAt: "2026-11-19T00:00:00.000Z" },
    });
    const i = makeInteraction(h.calls, { ephemeralMessage: true });
    await handlePanelAction(
      i.interaction,
      route("pick", { category: "NORMAL" }),
      h.deps,
    );
    expect(h.api.rsvp).not.toHaveBeenCalled();
    expect(i.text()).toMatch(/locked/i);
    expect(h.refreshPublicPost).not.toHaveBeenCalled();
  });

  it("a double click on an already-registered user does not re-register", async () => {
    const h = makeHarness({
      rsvp: {
        status: "GOING",
        signupRole: "PLAYER",
        selectedCategory: "NORMAL",
        guests: [],
        backupDmStatus: null,
      },
    });
    const i = makeInteraction(h.calls, { ephemeralMessage: true });
    await handlePanelAction(
      i.interaction,
      route("pick", { category: "HEROIC" }),
      h.deps,
    );
    expect(h.api.rsvp).not.toHaveBeenCalled();
    expect(i.text()).toMatch(/signed up as a player \(Normal\)/);
  });

  it("surfaces API validation/eligibility errors privately and does not refresh the post", async () => {
    const h = makeHarness();
    (h.api.rsvp as any).mockRejectedValueOnce(
      new ArtemisApiError(
        403,
        JSON.stringify({
          message: "You do not have the required role for this signup option.",
        }),
      ),
    );
    const i = makeInteraction(h.calls, { ephemeralMessage: true });
    await handlePanelAction(
      i.interaction,
      route("pick", { category: "NORMAL" }),
      h.deps,
    );
    expect(i.text()).toBe(
      "You do not have the required role for this signup option.",
    );
    expect(h.refreshPublicPost).not.toHaveBeenCalled();
  });
});

describe("handlePanelAction: wrong actor and invalid input", () => {
  it.each(["pick", "cancel", "cancel_yes", "keep", "backup", "refresh"])(
    "%s from a different user is refused with no API call",
    async (action) => {
      const h = makeHarness();
      const i = makeInteraction(h.calls, {
        userId: INTRUDER,
        ephemeralMessage: true,
      });
      await handlePanelAction(
        i.interaction,
        route(action, action === "pick" ? { category: "NORMAL" } : {}),
        h.deps,
      );
      expect(h.calls).toEqual(["interaction.reply"]);
      const reply = i.replies[0].p;
      expect(reply.flags).toBe(MessageFlags.Ephemeral);
      expect(reply.content).toMatch(/not yours|belongs to someone else/i);
      expect(h.api.rsvp).not.toHaveBeenCalled();
      expect(h.api.cancelRsvp).not.toHaveBeenCalled();
    },
  );
});

describe("handleMySignup", () => {
  it("defers, loads the actor's own view and renders it", async () => {
    const h = makeHarness({
      rsvp: {
        status: "GOING",
        signupRole: "PLAYER",
        selectedCategory: "NORMAL",
        guests: ["Pat"],
        backupDmStatus: null,
      },
    });
    const i = makeInteraction(h.calls);
    await handleMySignup(i.interaction, EVT, h.deps);
    expect(h.calls.slice(0, 2)).toEqual([
      "interaction.deferReply",
      "api.getMySignup",
    ]);
    expect(i.text()).toContain("Pat");
    expect(h.refreshPublicPost).not.toHaveBeenCalled();
  });

  it("checks backup eligibility live and hides the button when ineligible", async () => {
    const h = makeHarness({
      eligible: false,
      rsvp: {
        status: "GOING",
        signupRole: "PLAYER",
        selectedCategory: "NORMAL",
        guests: [],
        backupDmStatus: null,
      },
    });
    const i = makeInteraction(h.calls);
    await handleMySignup(i.interaction, EVT, h.deps);
    expect(h.log.find((l) => l.name === "checkEligibility")!.args[0]).toEqual({
      discordUserId: ACTOR,
      memberDiscordRoleIds: ["role-1", "role-2"],
      signupRole: "BACKUP_DM",
    });
    expect(i.buttons().map((b) => b.label)).not.toContain(
      "Add backup DM availability",
    );
  });

  it("fails closed (no backup button) if the eligibility check errors", async () => {
    const h = makeHarness({
      rsvp: {
        status: "GOING",
        signupRole: "PLAYER",
        selectedCategory: "NORMAL",
        guests: [],
        backupDmStatus: null,
      },
    });
    (h.api.checkEligibility as any).mockRejectedValueOnce(new Error("down"));
    const i = makeInteraction(h.calls);
    await handleMySignup(i.interaction, EVT, h.deps);
    expect(i.buttons().map((b) => b.label)).not.toContain(
      "Add backup DM availability",
    );
    expect(i.buttons().map((b) => b.label)).toContain("Cancel signup");
  });

  it("does not run the eligibility check when no backup action applies", async () => {
    const h = makeHarness();
    const i = makeInteraction(h.calls);
    await handleMySignup(i.interaction, EVT, h.deps);
    expect(h.api.checkEligibility).not.toHaveBeenCalled();
  });
});

describe("handlePanelAction: cancel", () => {
  const player = {
    status: "GOING",
    signupRole: "PLAYER",
    selectedCategory: "NORMAL",
    guests: ["Pat"],
    backupDmStatus: null,
  };

  it("asks for explicit confirmation first and states the guest policy", async () => {
    const h = makeHarness({ rsvp: { ...player } });
    const i = makeInteraction(h.calls, { ephemeralMessage: true });
    await handlePanelAction(i.interaction, route("cancel"), h.deps);
    expect(h.api.cancelRsvp).not.toHaveBeenCalled();
    expect(i.text()).toMatch(/also removes your 1 guest/);
    expect(i.buttons().map((b) => b.label)).toEqual([
      "Yes, cancel my signup",
      "Keep my signup",
    ]);
  });

  it("confirm cancels as the actor, shows the result and refreshes the public post", async () => {
    const h = makeHarness({ rsvp: { ...player } });
    const i = makeInteraction(h.calls, { ephemeralMessage: true });
    await handlePanelAction(i.interaction, route("cancel_yes"), h.deps);
    expect(h.log.find((l) => l.name === "cancelRsvp")!.args).toEqual([
      EVT,
      ACTOR,
    ]);
    expect(i.text()).toMatch(/^Your signup has been cancelled/);
    expect(h.refreshPublicPost).toHaveBeenCalledTimes(1);
  });

  it("keep returns to the panel without changes", async () => {
    const h = makeHarness({ rsvp: { ...player } });
    const i = makeInteraction(h.calls, { ephemeralMessage: true });
    await handlePanelAction(i.interaction, route("keep"), h.deps);
    expect(h.api.cancelRsvp).not.toHaveBeenCalled();
    expect(i.text()).toMatch(/signed up as a player/);
  });

  it("a stale confirm for someone no longer registered is a harmless no-op", async () => {
    const h = makeHarness({ rsvp: { ...player, status: "CANCELLED" } });
    const i = makeInteraction(h.calls, { ephemeralMessage: true });
    await handlePanelAction(i.interaction, route("cancel_yes"), h.deps);
    expect(h.api.cancelRsvp).not.toHaveBeenCalled();
    expect(i.text()).toMatch(
      /not currently signed up|no longer signed up|cancelled/i,
    );
    expect(h.refreshPublicPost).not.toHaveBeenCalled();
  });

  it("an API 404 during cancel is explained, not thrown", async () => {
    const h = makeHarness({ rsvp: { ...player } });
    (h.api.cancelRsvp as any).mockRejectedValueOnce(
      new ArtemisApiError(404, "RSVP not found"),
    );
    const i = makeInteraction(h.calls, { ephemeralMessage: true });
    await handlePanelAction(i.interaction, route("cancel_yes"), h.deps);
    expect(i.text()).toMatch(/don't have an active/i);
  });

  it("an active GM is never offered cancel and a forged cancel is refused", async () => {
    const h = makeHarness({
      tables: [
        {
          id: "t1",
          title: "My Table",
          tableType: "NORMAL",
          softCap: 5,
          hardCap: 6,
          status: "OPEN",
          ambassadorProfile: { discordUserId: ACTOR, displayName: "Me" },
        },
      ],
    });
    const i = makeInteraction(h.calls, { ephemeralMessage: true });
    await handlePanelAction(i.interaction, route("cancel_yes"), h.deps);
    expect(h.api.cancelRsvp).not.toHaveBeenCalled();
    expect(i.text()).toMatch(/contact an organizer/i);
  });

  it("cancelling on a cancelled event is not offered", async () => {
    const h = makeHarness({
      rsvp: { ...player },
      eventOverrides: { status: "CANCELLED" },
    });
    const i = makeInteraction(h.calls, { ephemeralMessage: true });
    await handlePanelAction(i.interaction, route("cancel_yes"), h.deps);
    expect(h.api.cancelRsvp).not.toHaveBeenCalled();
  });
});

describe("handlePanelAction: backup availability", () => {
  const player = {
    status: "GOING",
    signupRole: "PLAYER",
    selectedCategory: "HEROIC",
    guests: [],
    backupDmStatus: null,
  };

  it("is an intentional opt-in that keeps the player's own category", async () => {
    const h = makeHarness({ rsvp: { ...player } });
    const i = makeInteraction(h.calls, { ephemeralMessage: true });
    await handlePanelAction(i.interaction, route("backup"), h.deps);
    const rsvp = h.log.find((l) => l.name === "rsvp")!;
    expect((rsvp.args[1] as any).signupRole).toBe("BACKUP_DM");
    expect((rsvp.args[1] as any).selectedCategory).toBe("HEROIC");
    expect((rsvp.args[1] as any).discordUserId).toBe(ACTOR);
    expect(i.text()).toMatch(/^Backup DM availability added/);
    expect(i.text()).toMatch(/Backup DM availability: \*\*on\*\*/);
    expect(h.refreshPublicPost).toHaveBeenCalledTimes(1);
  });

  it("ineligible users are refused before the mutation", async () => {
    const h = makeHarness({ rsvp: { ...player }, eligible: false });
    const i = makeInteraction(h.calls, { ephemeralMessage: true });
    await handlePanelAction(i.interaction, route("backup"), h.deps);
    expect(h.api.rsvp).not.toHaveBeenCalled();
    expect(i.text()).toMatch(/not eligible/i);
  });

  it("is not available to someone without a player signup (no implicit Player+DM)", async () => {
    const h = makeHarness();
    const i = makeInteraction(h.calls, { ephemeralMessage: true });
    await handlePanelAction(i.interaction, route("backup"), h.deps);
    expect(h.api.rsvp).not.toHaveBeenCalled();
  });
});

describe("handleRunTable", () => {
  it("defers first; an unregistered user is pointed at the validated host form", async () => {
    const h = makeHarness();
    const i = makeInteraction(h.calls);
    await handleRunTable(i.interaction, EVT, h.deps);
    expect(h.calls.slice(0, 2)).toEqual([
      "interaction.deferReply",
      "api.getMySignup",
    ]);
    expect(i.buttons()).toEqual([{ id: `host:${EVT}`, label: "Open DM form" }]);
    expect(h.api.rsvp).not.toHaveBeenCalled();
  });

  it("a registered player cannot silently become a DM and keeps guest ownership", async () => {
    const h = makeHarness({
      rsvp: {
        status: "GOING",
        signupRole: "PLAYER",
        selectedCategory: "NORMAL",
        guests: ["Pat"],
        backupDmStatus: null,
      },
    });
    const i = makeInteraction(h.calls);
    await handleRunTable(i.interaction, EVT, h.deps);
    expect(i.text()).toMatch(/cancel your player signup/i);
    expect(i.buttons().map((b) => b.id)).toEqual([`my_signup:${EVT}`]);
    expect(h.api.rsvp).not.toHaveBeenCalled();
  });
});

describe("error handling stays private", () => {
  it("never throws user-facing validation errors to the public channel", async () => {
    const h = makeHarness();
    (h.api.getMySignup as any).mockRejectedValueOnce(
      new ArtemisApiError(403, JSON.stringify({ message: "Guild mismatch" })),
    );
    const i = makeInteraction(h.calls);
    await handleMySignup(i.interaction, EVT, h.deps);
    expect(i.text()).toBe("Guild mismatch");
    // every response went through deferReply/editReply (ephemeral), never a public reply
    expect(i.raw.deferReply).toHaveBeenCalledWith({
      flags: MessageFlags.Ephemeral,
    });
    expect(i.raw.reply).not.toHaveBeenCalled();
  });
});
