import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NestFactory, APP_GUARD } from "@nestjs/core";
import { Module } from "@nestjs/common";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { ApiTokenGuard } from "../common/api-token.guard.js";
import { EventGuildScopeGuard } from "../common/guild-scope.guard.js";
import { IS_PUBLIC_ROUTE } from "../common/public.decorator.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { DiscordEventPostService } from "./discord-event-post.service.js";
import { DiscordRoleService } from "./discord-role.service.js";
import { EventsController } from "./events.controller.js";
import { EventsService } from "./events.service.js";
import { MessageJobsService } from "./message-jobs.service.js";

// Real controller + real ApiTokenGuard + real EventGuildScopeGuard over a real
// Fastify HTTP stack (inject). Only the data layer is faked. This verifies the
// trust boundary of the actor-assertion route, not just the handler body.

const TOKEN = "test-internal-token";
const ACTOR = "100000000000000001";

const getMySignup = vi.fn(async (_eventId: string, actor: string) => ({
  eventId: "evt1",
  echoedActor: actor,
}));

const prismaFake = {
  client: {
    event: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === "evt1" ? { guildId: "g1" } : null,
    },
  },
};

@Module({
  controllers: [EventsController],
  providers: [
    { provide: APP_GUARD, useClass: ApiTokenGuard },
    { provide: PrismaService, useValue: prismaFake },
    { provide: EventsService, useValue: { getMySignup } },
    { provide: DiscordEventPostService, useValue: {} },
    { provide: MessageJobsService, useValue: {} },
    { provide: DiscordRoleService, useValue: {} },
  ],
})
class TestModule {}

let app: NestFastifyApplication;
const savedToken = process.env.INTERNAL_API_TOKEN;

beforeAll(async () => {
  process.env.INTERNAL_API_TOKEN = TOKEN;
  app = await NestFactory.create<NestFastifyApplication>(
    TestModule,
    new FastifyAdapter({ logger: false }),
    { logger: false },
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
  if (savedToken === undefined) delete process.env.INTERNAL_API_TOKEN;
  else process.env.INTERNAL_API_TOKEN = savedToken;
});

const call = (
  headers: Record<string, string>,
  url = "/api/v1/events/evt1/my-signup",
) => app.inject({ method: "GET", url, headers });

const good = {
  "x-artemis-token": TOKEN,
  "x-artemis-guild-id": "g1",
  "x-artemis-actor-discord-id": ACTOR,
};

describe("GET /api/v1/events/:id/my-signup", () => {
  it("serves the actor taken from the internal assertion header", async () => {
    getMySignup.mockClear();
    const res = await call(good);
    expect(res.statusCode).toBe(200);
    expect(getMySignup).toHaveBeenCalledWith("evt1", ACTOR);
  });

  it("requires the internal API token", async () => {
    const { "x-artemis-token": _t, ...noToken } = good;
    expect((await call(noToken)).statusCode).toBe(401);
    expect(
      (await call({ ...good, "x-artemis-token": "wrong" })).statusCode,
    ).toBe(401);
  });

  it("requires the guild header and rejects a cross-guild caller", async () => {
    const { "x-artemis-guild-id": _g, ...noGuild } = good;
    expect((await call(noGuild)).statusCode).toBe(400);
    getMySignup.mockClear();
    expect(
      (await call({ ...good, "x-artemis-guild-id": "other-guild" })).statusCode,
    ).toBe(403);
    expect(getMySignup).not.toHaveBeenCalled();
  });

  it("404s an unknown event before the actor is considered", async () => {
    expect(
      (await call(good, "/api/v1/events/missing/my-signup")).statusCode,
    ).toBe(404);
  });

  it("rejects a missing or malformed actor assertion", async () => {
    getMySignup.mockClear();
    const { "x-artemis-actor-discord-id": _a, ...noActor } = good;
    expect((await call(noActor)).statusCode).toBe(400);
    for (const bad of ["", "u1", "123", "abc", `${ACTOR},${ACTOR}`]) {
      expect(
        (await call({ ...good, "x-artemis-actor-discord-id": bad })).statusCode,
      ).toBe(400);
    }
    expect(getMySignup).not.toHaveBeenCalled();
  });

  it("does not accept a target user from the query string", async () => {
    getMySignup.mockClear();
    for (const q of [
      `?userId=${ACTOR}`,
      `?discordUserId=${ACTOR}`,
      `?actorDiscordId=${ACTOR}`,
      "?anything=1",
    ]) {
      const res = await call(good, `/api/v1/events/evt1/my-signup${q}`);
      expect(res.statusCode).toBe(400);
    }
    expect(getMySignup).not.toHaveBeenCalled();
  });

  it("is protected by the event guild guard and is never @Public", () => {
    const guards: unknown[] =
      Reflect.getMetadata("__guards__", EventsController) ?? [];
    expect(guards).toContain(EventGuildScopeGuard);
    const handler = EventsController.prototype.mySignup;
    expect(Reflect.getMetadata(IS_PUBLIC_ROUTE, handler)).toBeUndefined();
    expect(
      Reflect.getMetadata(IS_PUBLIC_ROUTE, EventsController),
    ).toBeUndefined();
  });
});
