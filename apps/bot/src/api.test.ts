import { afterEach, describe, expect, it, vi } from "vitest";
import { ArtemisApi, withGuildContext } from "./api.js";

const ACTOR = "100000000000000001";
const config = {
  DISCORD_TOKEN: "x",
  API_URL: "http://api.test",
  INTERNAL_API_TOKEN: "internal-token",
} as never;

function stubFetch(body: unknown = {}) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => body,
    text: async () => "",
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("ArtemisApi.getMySignup", () => {
  it("sends the actor only as the internal assertion header, never in the URL", async () => {
    const fetchMock = stubFetch({ eventId: "evt1" });
    await withGuildContext("g1", () =>
      new ArtemisApi(config).getMySignup("evt1", ACTOR),
    );

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, any];
    expect(url).toBe("http://api.test/api/v1/events/evt1/my-signup");
    expect(init.method).toBe("GET");
    expect(init.headers["x-artemis-actor-discord-id"]).toBe(ACTOR);
    expect(init.headers["x-artemis-token"]).toBe("internal-token");
    expect(init.headers["x-artemis-guild-id"]).toBe("g1");
    expect(url).not.toContain(ACTOR);
    expect(init.body).toBeUndefined();
  });

  it("refuses to call the API with a malformed actor", async () => {
    const fetchMock = stubFetch();
    const api = new ArtemisApi(config);
    for (const bad of ["", "u1", `${ACTOR}\n`, "x".repeat(40)]) {
      await expect(api.getMySignup("evt1", bad)).rejects.toThrow(/actor/i);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not leak the actor header onto other requests", async () => {
    const fetchMock = stubFetch({});
    await new ArtemisApi(config).getEvent("evt1");
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, any];
    expect(init.headers["x-artemis-actor-discord-id"]).toBeUndefined();
  });

  it("encodes the event id path segment", async () => {
    const fetchMock = stubFetch();
    await new ArtemisApi(config).getMySignup("a/b?c", ACTOR);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe("http://api.test/api/v1/events/a%2Fb%3Fc/my-signup");
  });
});

describe("ArtemisApi.checkEligibility", () => {
  it("posts the member's roles for the requested signup role", async () => {
    const fetchMock = stubFetch({ eligible: true });
    await new ArtemisApi(config).checkEligibility("evt1", {
      discordUserId: ACTOR,
      memberDiscordRoleIds: ["r1"],
      signupRole: "BACKUP_DM",
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, any];
    expect(url).toBe("http://api.test/api/v1/events/evt1/eligibility/check");
    expect(JSON.parse(init.body)).toEqual({
      discordUserId: ACTOR,
      memberDiscordRoleIds: ["r1"],
      signupRole: "BACKUP_DM",
    });
  });
});
