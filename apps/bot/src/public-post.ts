// Locating and refreshing the CANONICAL public event post.
//
// An interaction's own message is only the public post when the click came from
// the public post itself. Clicks from the ephemeral personal panel (and modal
// submits that came from it) have an ephemeral `interaction.message`; editing
// that with the public embed would replace the participant's private panel.
// So the target is resolved from, in order:
//   1. the event's persisted channelId/messageId (set by the canonical publish),
//   2. the public message id the panel buttons carried from the original click
//      (covers posts created by the slash command, which does not persist it),
//   3. the clicked message itself, only if it is demonstrably not ephemeral.
import { MessageFlags } from "discord.js";

type MessageLike = {
  id: string;
  channelId?: string;
  flags?: { has(flag: number): boolean };
};

export type PostRefreshSource = {
  /** Public post message id carried in the panel custom IDs, if any. */
  hintedMessageId?: string;
  channelId?: string | null;
  /** True when the interaction came from an ephemeral panel message. */
  sourceIsEphemeral: boolean;
  interactionMessage?: unknown;
};

export type PostTarget = { channelId: string; messageId: string };

const asMessage = (value: unknown): MessageLike | null =>
  value &&
  typeof value === "object" &&
  typeof (value as MessageLike).id === "string"
    ? (value as MessageLike)
    : null;

export function resolvePublicPostTarget(
  event: { channelId?: string | null; messageId?: string | null },
  source: PostRefreshSource,
): PostTarget | null {
  if (event.channelId && event.messageId) {
    return { channelId: event.channelId, messageId: event.messageId };
  }
  if (source.hintedMessageId && source.channelId) {
    return { channelId: source.channelId, messageId: source.hintedMessageId };
  }
  const message = asMessage(source.interactionMessage);
  const ephemeral =
    source.sourceIsEphemeral ||
    Boolean(message?.flags?.has(MessageFlags.Ephemeral));
  const channelId = message?.channelId ?? source.channelId;
  if (message && !ephemeral && channelId) {
    return { channelId, messageId: message.id };
  }
  return null;
}

export type RefreshDeps<
  TEvent extends { channelId?: string | null; messageId?: string | null },
> = {
  getEvent(eventId: string): Promise<TEvent>;
  fetchMessage(
    channelId: string,
    messageId: string,
  ): Promise<{ edit(payload: unknown): Promise<unknown> } | null>;
  render(event: TEvent): unknown;
  warn(message: string, details?: Record<string, unknown>): void;
};

/** Best-effort: a failed refresh never fails the participant's action. */
export async function refreshPublicPost<
  TEvent extends { channelId?: string | null; messageId?: string | null },
>(
  deps: RefreshDeps<TEvent>,
  eventId: string,
  source: PostRefreshSource,
): Promise<void> {
  try {
    const event = await deps.getEvent(eventId);
    const target = resolvePublicPostTarget(event, source);
    if (!target) return;
    const message = await deps.fetchMessage(target.channelId, target.messageId);
    if (!message) {
      deps.warn("Public event post not found for refresh", {
        eventId,
        ...target,
      });
      return;
    }
    await message.edit(deps.render(event));
  } catch (error) {
    deps.warn("Could not refresh public event post", {
      eventId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
