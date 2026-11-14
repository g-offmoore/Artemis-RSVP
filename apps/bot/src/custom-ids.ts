// Custom ID routing for public post buttons and the ephemeral personal panel.
// Pure (no discord.js) so routing is testable without starting the bot.
//
// Public post (current):   join:<event> | run_table:<event> | my_signup:<event>
// Ephemeral panel actions: sp:<action>:<event>:<actorId>:<category|->[:<postMessageId>]
// Legacy (already-posted messages keep working):
//   rsvp:<event>[:<category>] guest:<event> guest_text:<event> host:<event>
//   dm:<event> prefs:<event> cancel_rsvp:<event> backup_dm:<event>
//   assignment:<event>  and the DM buttons backupdm:accept|decline:<event>:<participant>
import { parseBackupDmCustomId, parseActorDiscordId } from "@artemis/domain";

export const STALE_BUTTON_MESSAGE =
  "That button is out of date. Use **My signup** on the event post to see your current options.";

export type PanelAction =
  | "pick"
  | "cancel"
  | "cancel_yes"
  | "keep"
  | "backup"
  | "refresh";

const PANEL_ACTIONS: readonly string[] = [
  "pick",
  "cancel",
  "cancel_yes",
  "keep",
  "backup",
  "refresh",
];

export type LegacyAction =
  | "rsvp"
  | "guest"
  | "guest_text"
  | "host"
  | "dm"
  | "prefs"
  | "cancel_rsvp"
  | "backup_dm"
  | "assignment";

const LEGACY_ACTIONS: readonly string[] = [
  "rsvp",
  "guest",
  "guest_text",
  "host",
  "dm",
  "prefs",
  "cancel_rsvp",
  "backup_dm",
  "assignment",
];

export type ButtonRoute =
  | { kind: "join" | "run_table" | "my_signup"; eventId: string }
  | {
      kind: "panel";
      action: PanelAction;
      eventId: string;
      actorId: string;
      category: string | undefined;
      postMessageId: string | undefined;
    }
  | {
      kind: "legacy";
      action: LegacyAction;
      eventId: string;
      category?: string;
    }
  | { kind: "backup_dm_response" };

export function buildPanelCustomId(
  action: PanelAction,
  eventId: string,
  actorId: string,
  options: { category?: string; postMessageId?: string } = {},
): string {
  const parts = ["sp", action, eventId, actorId, options.category ?? "-"];
  if (options.postMessageId) parts.push(options.postMessageId);
  return parts.join(":");
}

/** Returns null for unknown/malformed IDs so callers can answer safely. */
export function parseButtonCustomId(customId: string): ButtonRoute | null {
  if (typeof customId !== "string" || customId.length === 0) return null;

  if (parseBackupDmCustomId(customId)) return { kind: "backup_dm_response" };

  const [prefix, ...rest] = customId.split(":");

  if (prefix === "sp") {
    const [action, eventId, actorId, category, postMessageId] = rest;
    if (!PANEL_ACTIONS.includes(action) || !eventId) return null;
    // Actor binding must be a well-formed snowflake.
    if (!parseActorDiscordId(actorId)) return null;
    const cat = category && category !== "-" ? category : undefined;
    if (action === "pick" && !cat) return null;
    return {
      kind: "panel",
      action: action as PanelAction,
      eventId,
      actorId,
      category: cat,
      postMessageId: postMessageId || undefined,
    };
  }

  const [eventId, category] = rest;
  if (!eventId) return null;

  if (prefix === "join" || prefix === "run_table" || prefix === "my_signup") {
    return { kind: prefix, eventId };
  }
  if (LEGACY_ACTIONS.includes(prefix)) {
    return {
      kind: "legacy",
      action: prefix as LegacyAction,
      eventId,
      ...(category ? { category } : {}),
    };
  }
  return null;
}
