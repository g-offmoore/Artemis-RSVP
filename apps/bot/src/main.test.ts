import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { buildMySignupView, type MySignupSource } from "@artemis/domain";
import { MessageFlags } from "discord.js";

// Exercise the actual gateway callback/router without connecting to Discord.
// Only Client transport and config are replaced; API, routing and renderers run.
const transport = vi.hoisted(() => ({
  handlers: new Map<string, (i: any) => Promise<void>>(),
  fetchMessage: vi.fn(),
  editPost: vi.fn(),
  order: [] as string[],
}));
vi.mock("./config.js", () => ({
  loadConfig: () => ({
    DISCORD_TOKEN: "test",
    INTERNAL_API_TOKEN: "test-token",
    API_URL: "http://api.test",
  }),
}));
vi.mock("discord.js", async (original) => {
  const actual = await original<typeof import("discord.js")>();
  return {
    ...actual,
    Client: class {
      channels = { fetch: transport.fetchMessage };
      once() {}
      on(event: string, fn: (i: any) => Promise<void>) {
        transport.handlers.set(event, fn);
      }
      login() {
        return Promise.resolve();
      }
    },
  };
});
const ACTOR = "100000000000000001";
const source = (): MySignupSource => ({
  event: {
    id: "evt1",
    title: "Night",
    status: "SIGNUP_OPEN",
    gameSystem: "D&D",
    startAt: "2099-12-01T23:00:00Z",
    eventType: { allowsGuests: true, maxGuestsPerRsvp: 3 },
  },
  rsvp: null,
});
let world: MySignupSource;
let requests: Array<{ url: string; init: any }>;
function interaction(customId: string, ephemeral = false) {
  return {
    customId,
    guildId: "g1",
    channelId: "chan1",
    user: { id: ACTOR, username: "Me" },
    member: { roles: [] },
    deferred: false,
    replied: false,
    message: {
      id: ephemeral ? "private1" : "post1",
      channelId: "chan1",
      flags: { has: () => ephemeral },
    },
    isChatInputCommand: () => false,
    isButton: () => true,
    isUserSelectMenu: () => false,
    isModalSubmit: () => false,
    isRepliable: () => true,
    deferReply: vi.fn(async function (this: any) {
      this.deferred = true;
      transport.order.push("defer");
    }),
    deferUpdate: vi.fn(async function (this: any) {
      this.deferred = true;
      transport.order.push("update");
    }),
    reply: vi.fn(async () => {
      transport.order.push("reply");
    }),
    editReply: vi.fn(async () => {}),
    followUp: vi.fn(async () => {}),
    showModal: vi.fn(async () => {
      transport.order.push("modal");
    }),
  };
}
const dispatch = (i: ReturnType<typeof interaction>) =>
  transport.handlers.get("interactionCreate")!(i);
beforeAll(async () => {
  await import("./main.js");
});
beforeEach(() => {
  world = source();
  requests = [];
  transport.order.length = 0;
  transport.editPost.mockReset();
  transport.fetchMessage.mockReset();
  transport.fetchMessage.mockResolvedValue({
    isTextBased: () => true,
    messages: { fetch: async () => ({ edit: transport.editPost }) },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: any) => {
      transport.order.push("network");
      requests.push({ url, init });
      let body: unknown;
      if (url.endsWith("/my-signup")) body = buildMySignupView(world, ACTOR);
      else if (url.endsWith("/eligibility/check")) body = { eligible: true };
      else if (url.endsWith("/rsvps")) {
        const payload = JSON.parse(init.body);
        world.rsvp = {
          primaryDiscordUserId: payload.discordUserId,
          status: "GOING",
          signupRole: "PLAYER",
          selectedCategory: payload.selectedCategory,
          participants: [],
        };
        body = {};
      } else
        body = {
          ...world.event,
          endAt: "2099-12-02T03:00:00Z",
          channelId: "canonical-channel",
          messageId: "canonical-post",
        };
      return { ok: true, json: async () => body };
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("main.ts interaction router", () => {
  it.each(["join", "my_signup", "run_table", "assignment"])(
    "%s uses the safe actor view after private deferral",
    async (prefix) => {
      const i = interaction(`${prefix}:evt1`);
      await dispatch(i);
      expect(transport.order.slice(0, 2)).toEqual(["defer", "network"]);
      expect(i.deferReply).toHaveBeenCalledWith({
        flags: MessageFlags.Ephemeral,
      });
      expect(requests[0].url).toBe(
        "http://api.test/api/v1/events/evt1/my-signup",
      );
      expect(requests[0].init.headers).toMatchObject({
        "x-artemis-actor-discord-id": ACTOR,
        "x-artemis-guild-id": "g1",
        "x-artemis-token": "test-token",
      });
    },
  );
  it("routes a panel pick, then refreshes the canonical post rather than the panel", async () => {
    const i = interaction(`sp:pick:evt1:${ACTOR}:HEROIC:post1`, true);
    await dispatch(i);
    expect(transport.order[0]).toBe("update");
    const mutation = requests.find((r) => r.url.endsWith("/rsvps"))!;
    expect(JSON.parse(mutation.init.body)).toMatchObject({
      discordUserId: ACTOR,
      selectedCategory: "HEROIC",
    });
    expect(transport.fetchMessage).toHaveBeenCalledWith("canonical-channel");
    expect(transport.editPost).toHaveBeenCalledTimes(1);
    expect(i.editReply.mock.calls.length).toBe(1);
  });
  it("legacy RSVP still calls the existing validated mutation", async () => {
    const i = interaction("rsvp:evt1:NORMAL");
    await dispatch(i);
    expect(requests.some((r) => r.url.endsWith("/rsvps"))).toBe(true);
    expect(transport.order[0]).toBe("defer");
  });
  it("wrong actor and unknown IDs fail privately without a network call", async () => {
    for (const id of [
      `sp:cancel_yes:evt1:200000000000000002:-`,
      "unknown:evt1",
    ]) {
      const i = interaction(id, true);
      await dispatch(i);
      expect(i.reply).toHaveBeenCalledWith(
        expect.objectContaining({ flags: MessageFlags.Ephemeral }),
      );
    }
    expect(requests).toEqual([]);
  });
  it("host form acknowledges with a modal before any network request", async () => {
    const i = interaction("host:evt1", true);
    await dispatch(i);
    expect(transport.order).toEqual(["modal"]);
  });
  it("guest controls explain that this replaces the whole guest list", async () => {
    const i = interaction("guest:evt1", true);
    await dispatch(i);
    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringMatching(/replace.*guest list/i),
        flags: MessageFlags.Ephemeral,
      }),
    );
    expect(requests).toEqual([]);
  });
  it("never defer-updates a public message for a personal panel ID", async () => {
    const i = interaction(`sp:refresh:evt1:${ACTOR}:-`);
    await dispatch(i);
    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral }),
    );
    expect(i.deferUpdate).not.toHaveBeenCalled();
    expect(requests).toEqual([]);
  });
});
