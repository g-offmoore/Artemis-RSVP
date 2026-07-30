import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { SetMetadata } from "@nestjs/common";
import { IS_PUBLIC_ROUTE } from "./public.decorator.js";
import { PrismaService } from "../prisma/prisma.service.js";

const GUILD_ID_HEADER = "x-artemis-guild-id";
const IS_GUILD_DIRECTORY_ROUTE = "isGuildDirectoryRoute";

/**
 * Marks a route as intentionally not scoped to a single guild — e.g. "list every guild
 * Artemis manages," used to bootstrap multi-guild auth before a caller has picked one.
 * Still requires the shared INTERNAL_API_TOKEN via ApiTokenGuard; only skips the
 * per-guild header/ownership check.
 */
export const GuildDirectoryRoute = () => SetMetadata(IS_GUILD_DIRECTORY_ROUTE, true);

interface GuildScopedRequest {
  headers: Record<string, string | string[] | undefined>;
  params: Record<string, string | undefined>;
  query: Record<string, unknown>;
  body: unknown;
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Read the caller-asserted guild id, required on every non-public route. */
export function requireHeaderGuildId(context: ExecutionContext): string {
  const request = context.switchToHttp().getRequest<GuildScopedRequest>();
  const guildId = firstHeaderValue(request.headers[GUILD_ID_HEADER]);
  if (!guildId) {
    throw new BadRequestException(`${GUILD_ID_HEADER} header is required`);
  }
  return guildId;
}

/** Throws if a loaded resource's guildId doesn't match the caller's asserted guild. */
export function assertGuildOwnership(resourceGuildId: string, requestGuildId: string, resourceName = "Resource") {
  if (resourceGuildId !== requestGuildId) {
    throw new ForbiddenException(`${resourceName} does not belong to this guild`);
  }
}

/**
 * Base guard: every non-public route must send x-artemis-guild-id. Routes that take a
 * guildId directly via query/body are checked here; routes scoped by a resource id are
 * checked by the resource-specific subclasses below, which load the resource's own
 * guildId and compare it against the header before the handler runs.
 */
@Injectable()
export class GuildScopeGuard implements CanActivate {
  constructor(@Inject(Reflector) protected readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const isDirectoryRoute = this.reflector.getAllAndOverride<boolean>(IS_GUILD_DIRECTORY_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isDirectoryRoute) return true;

    const guildId = requireHeaderGuildId(context);
    const request = context.switchToHttp().getRequest<GuildScopedRequest>();

    const queryGuildId = typeof request.query?.guildId === "string" ? request.query.guildId : undefined;
    if (queryGuildId && queryGuildId !== guildId) {
      throw new ForbiddenException("guildId query param does not match x-artemis-guild-id header");
    }

    const bodyGuildId =
      request.body && typeof request.body === "object" && "guildId" in (request.body as Record<string, unknown>)
        ? (request.body as Record<string, unknown>).guildId
        : undefined;
    if (typeof bodyGuildId === "string" && bodyGuildId !== guildId) {
      throw new ForbiddenException("guildId body field does not match x-artemis-guild-id header");
    }

    return true;
  }
}

abstract class ResourceGuildScopeGuard extends GuildScopeGuard {
  constructor(
    reflector: Reflector,
    protected readonly prisma: PrismaService,
    private readonly resourceName: string,
  ) {
    super(reflector);
  }

  protected abstract loadResourceGuildId(id: string): Promise<string | null>;

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const isDirectoryRoute = this.reflector.getAllAndOverride<boolean>(IS_GUILD_DIRECTORY_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isDirectoryRoute) return true;

    const guildId = requireHeaderGuildId(context);
    const request = context.switchToHttp().getRequest<GuildScopedRequest>();
    const resourceId = request.params?.id;

    if (!resourceId) {
      // No path-scoped resource id on this route (e.g. list/create) — fall back to the
      // base query/body guildId check.
      return super.canActivate(context);
    }

    const resourceGuildId = await this.loadResourceGuildId(resourceId);
    if (!resourceGuildId) {
      throw new NotFoundException(`${this.resourceName} not found`);
    }
    assertGuildOwnership(resourceGuildId, guildId, this.resourceName);
    return true;
  }
}

@Injectable()
export class EventGuildScopeGuard extends ResourceGuildScopeGuard {
  constructor(reflector: Reflector, prisma: PrismaService) {
    super(reflector, prisma, "Event");
  }

  protected async loadResourceGuildId(id: string): Promise<string | null> {
    const event = await this.prisma.client.event.findUnique({
      where: { id },
      select: { guildId: true },
    });
    return event?.guildId ?? null;
  }
}

@Injectable()
export class EventSeriesGuildScopeGuard extends ResourceGuildScopeGuard {
  constructor(reflector: Reflector, prisma: PrismaService) {
    super(reflector, prisma, "Event series");
  }

  protected async loadResourceGuildId(id: string): Promise<string | null> {
    const series = await this.prisma.client.eventSeries.findUnique({
      where: { id },
      select: { guildId: true },
    });
    return series?.guildId ?? null;
  }
}

/**
 * For routes keyed directly by guildId via a `:guildId` path param and/or a `guildId`
 * query param (e.g. GuildSettings' GET ?guildId= / PATCH :guildId).
 */
@Injectable()
export class PathGuildIdScopeGuard extends GuildScopeGuard {
  canActivate(context: ExecutionContext): boolean {
    // Runs the shared query/body guildId check first, then also checks the path param.
    if (!super.canActivate(context)) return false;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    const isDirectoryRoute = this.reflector.getAllAndOverride<boolean>(IS_GUILD_DIRECTORY_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic || isDirectoryRoute) return true;

    const guildId = requireHeaderGuildId(context);
    const request = context.switchToHttp().getRequest<GuildScopedRequest>();
    const pathGuildId = request.params?.guildId;
    if (pathGuildId && pathGuildId !== guildId) {
      throw new ForbiddenException("guildId path param does not match x-artemis-guild-id header");
    }
    return true;
  }
}

@Injectable()
export class AmbassadorGuildScopeGuard extends ResourceGuildScopeGuard {
  constructor(reflector: Reflector, prisma: PrismaService) {
    super(reflector, prisma, "Ambassador profile");
  }

  protected async loadResourceGuildId(id: string): Promise<string | null> {
    const ambassador = await this.prisma.client.ambassadorProfile.findUnique({
      where: { id },
      select: { guildId: true },
    });
    return ambassador?.guildId ?? null;
  }
}
