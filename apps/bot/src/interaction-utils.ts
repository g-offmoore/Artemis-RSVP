// Small interaction helpers shared by main.ts and the testable panel handlers.
import { ArtemisApiError } from "./api.js";

// Extracts the member's Discord role IDs for API eligibility checks.
// Works for both GuildMember (.roles.cache Collection) and
// APIInteractionGuildMember (.roles string[]).
export function extractMemberRoleIds(member: unknown): string[] {
  if (!member || typeof member !== "object") return [];
  const roles = (member as Record<string, unknown>).roles;
  if (!roles) return [];
  if (Array.isArray(roles)) return roles as string[];
  const cache = (roles as Record<string, unknown>).cache;
  if (cache && typeof (cache as Map<string, unknown>).keys === "function") {
    return [...(cache as Map<string, unknown>).keys()];
  }
  return [];
}

export function memberDisplayName(interaction: {
  member?: unknown;
  user: { username: string };
}): string {
  const member = interaction.member;
  return member && typeof member === "object" && "displayName" in member
    ? String((member as { displayName: unknown }).displayName)
    : interaction.user.username;
}

export function userFacingError(error: unknown) {
  if (error instanceof ArtemisApiError) {
    if (error.status === 404 && /RSVP not found/i.test(error.responseBody)) {
      return "RSVP first, then add guests.";
    }
    // 400 Bad Request, 403 Forbidden, 409 Conflict — all carry a user-readable message.
    if (error.status === 400 || error.status === 403 || error.status === 409) {
      return (
        apiValidationMessage(error.responseBody) ??
        "Artemis could not save that because part of the request was not valid."
      );
    }
  }

  return "Artemis could not complete that action. Staff has been notified if alerts are configured.";
}

export function apiValidationMessage(responseBody: string) {
  try {
    const body = JSON.parse(responseBody) as {
      message?: string;
      issues?: Array<{ path: string; message: string }>;
    };
    if (Array.isArray(body.issues) && body.issues.length) {
      return body.issues
        .slice(0, 3)
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("\n");
    }
    return body.message;
  } catch {
    return undefined;
  }
}
