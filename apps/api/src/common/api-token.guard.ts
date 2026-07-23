import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC_ROUTE } from "./public.decorator.js";

@Injectable()
export class ApiTokenGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass()
    ]);
    if (isPublic) return true;

    // INTERNAL_API_TOKEN is required at boot (see common/env.ts loadEnv()); if it's somehow
    // still unset here, fail closed rather than silently disabling auth for every request.
    const expected = process.env.INTERNAL_API_TOKEN;
    if (!expected) {
      throw new UnauthorizedException("INTERNAL_API_TOKEN is not configured");
    }

    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined> }>();
    const header = request.headers["x-artemis-token"];
    const bearer = request.headers.authorization;
    const authorization = Array.isArray(bearer) ? bearer[0] : bearer;
    const token = Array.isArray(header) ? header[0] : header ?? authorization?.replace(/^Bearer\s+/i, "");

    if (token !== expected) {
      throw new UnauthorizedException("Missing or invalid API token");
    }

    return true;
  }
}
