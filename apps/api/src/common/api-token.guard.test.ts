import { afterEach, describe, expect, it, vi } from "vitest";
import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { ApiTokenGuard } from "./api-token.guard.js";

function makeReflector(isPublic = false) {
  return {
    getAllAndOverride: vi.fn(() => isPublic),
  } as unknown as import("@nestjs/core").Reflector;
}

function makeContext(headers: Record<string, string>): ExecutionContext {
  return {
    getHandler: () => ({}) as never,
    getClass: () => ({}) as never,
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

describe("ApiTokenGuard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails closed when INTERNAL_API_TOKEN is unset, rather than allowing every request", () => {
    vi.stubEnv("INTERNAL_API_TOKEN", "");
    const guard = new ApiTokenGuard(makeReflector());
    expect(() => guard.canActivate(makeContext({ "x-artemis-token": "anything" }))).toThrow(UnauthorizedException);
  });

  it("rejects a mismatched token", () => {
    vi.stubEnv("INTERNAL_API_TOKEN", "expected-secret");
    const guard = new ApiTokenGuard(makeReflector());
    expect(() => guard.canActivate(makeContext({ "x-artemis-token": "wrong" }))).toThrow(UnauthorizedException);
  });

  it("allows a matching token", () => {
    vi.stubEnv("INTERNAL_API_TOKEN", "expected-secret");
    const guard = new ApiTokenGuard(makeReflector());
    expect(guard.canActivate(makeContext({ "x-artemis-token": "expected-secret" }))).toBe(true);
  });

  it("allows public routes without a token", () => {
    const guard = new ApiTokenGuard(makeReflector(true));
    expect(guard.canActivate(makeContext({}))).toBe(true);
  });
});
