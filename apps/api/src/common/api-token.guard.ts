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

    const expected = process.env.INTERNAL_API_TOKEN;
    if (!expected) return true;

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
