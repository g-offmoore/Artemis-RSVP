import { ActionRowBuilder, ButtonBuilder, EmbedBuilder } from "discord.js";
import {
  buildEventButtonRows,
  buildEventEmbed,
  formatDiscordTimestamp,
  resolveEventVocabulary,
  type EventPresentationInput,
} from "@artemis/domain/event-presentation";

export { formatDiscordTimestamp };

export type EventVocabulary = ReturnType<typeof resolveEventVocabulary>;

export function eventVocabulary(event: { gameSystem?: string | null }) {
  return resolveEventVocabulary(event.gameSystem);
}

// discord.js adapter over the shared presentation descriptors. ButtonStyle
// numeric values match the shared descriptor styles.
export function eventEmbed(event: EventPresentationInput) {
  return new EmbedBuilder(buildEventEmbed(event));
}

// Cancelled events return no rows: stale buttons must not remain clickable.
export function eventButtons(
  event: Parameters<typeof buildEventButtonRows>[0],
): ActionRowBuilder<ButtonBuilder>[] {
  return buildEventButtonRows(event).map((row) =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      ...row.map((b) =>
        new ButtonBuilder()
          .setCustomId(b.customId)
          .setLabel(b.label)
          .setStyle(b.style),
      ),
    ),
  );
}
