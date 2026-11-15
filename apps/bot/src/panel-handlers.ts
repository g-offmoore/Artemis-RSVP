// Handlers for the public Join / Run a table / My signup controls and the
// ephemeral personal panel. They take their collaborators as arguments (no
// import of main.ts, no Discord client) so they are testable with a fake
// interaction and a fake API.
//
// Rules every handler follows:
//  - Acknowledge privately (deferReply / deferUpdate) BEFORE any network call.
//    Only the wrong-actor refusal replies without deferring, because it makes
//    no network call.
//  - The actor is ALWAYS interaction.user.id. IDs carry an actor binding that
//    is only checked for equality; they never supply identity.
//  - Re-read the participant-safe view before any mutation (stale panels).
//  - Mutations reuse the existing API RSVP / cancel endpoints, which re-validate
//    eligibility, windows, guest limits and lifecycle server-side.
//  - Responses are ephemeral edits of the panel. The public post is refreshed
//    through the injected refreshPublicPost (canonical message), never by
//    editing the interaction message.
import { MessageFlags } from "discord.js";
import type { ActionRowBuilder, ButtonBuilder } from "discord.js";
import type { MySignupView } from "@artemis/domain";
import { ArtemisApiError } from "./api.js";
import type { ButtonRoute } from "./custom-ids.js";
import {
  extractMemberRoleIds,
  memberDisplayName,
  userFacingError,
} from "./interaction-utils.js";
import type { PostRefreshSource } from "./public-post.js";
import {
  buildCancelConfirm,
  buildJoinChoice,
  buildRunTableMessage,
  buildSignupPanel,
  toDiscordRows,
  type PanelMessage,
} from "./signup-panel.js";

export interface PanelApi {
  getMySignup(eventId: string, actorDiscordId: string): Promise<MySignupView>;
  rsvp(eventId: string, payload: Record<string, unknown>): Promise<unknown>;
  cancelRsvp(eventId: string, discordUserId: string): Promise<unknown>;
  checkEligibility(
    eventId: string,
    payload: {
      discordUserId: string;
      memberDiscordRoleIds: string[];
      signupRole: "PLAYER" | "TABLE_DM" | "BACKUP_DM" | "AMBASSADOR";
    },
  ): Promise<{ eligible: boolean; reason?: string }>;
}

export interface PanelDeps {
  api: PanelApi;
  refreshPublicPost(eventId: string, source: PostRefreshSource): Promise<void>;
}

type EditPayload = {
  content: string;
  components: ActionRowBuilder<ButtonBuilder>[];
};

export interface PanelInteraction {
  user: { id: string; username: string };
  member?: unknown;
  channelId?: string | null;
  message?: {
    id: string;
    channelId?: string;
    flags?: { has(flag: number): boolean };
  } | null;
  deferReply(options: { flags: MessageFlags.Ephemeral }): Promise<unknown>;
  deferUpdate(): Promise<unknown>;
  reply(options: {
    content: string;
    flags: MessageFlags.Ephemeral;
  }): Promise<unknown>;
  editReply(options: EditPayload): Promise<unknown>;
}

type PanelRoute = Extract<ButtonRoute, { kind: "panel" }>;

const isEphemeralSource = (interaction: PanelInteraction) =>
  Boolean(interaction.message?.flags?.has(MessageFlags.Ephemeral));

// A public post id can only be taken from a click on the public post itself.
const publicPostHint = (interaction: PanelInteraction) =>
  interaction.message && !isEphemeralSource(interaction)
    ? interaction.message.id
    : undefined;

function render(message: PanelMessage): EditPayload {
  return { content: message.content, components: toDiscordRows(message.rows) };
}

function plain(content: string): EditPayload {
  return { content, components: [] };
}

async function loadPanel(
  interaction: PanelInteraction,
  eventId: string,
  deps: PanelDeps,
  options: {
    notice?: string;
    postMessageId?: string;
    view?: MySignupView;
  } = {},
): Promise<MySignupView> {
  const actor = interaction.user.id;
  const view = options.view ?? (await deps.api.getMySignup(eventId, actor));

  let backupEligible: boolean | undefined;
  if (view.actions.addBackup) {
    // Fail closed: if the pre-check errors the opt-in is simply not offered.
    backupEligible = await deps.api
      .checkEligibility(eventId, {
        discordUserId: actor,
        memberDiscordRoleIds: extractMemberRoleIds(interaction.member),
        signupRole: "BACKUP_DM",
      })
      .then((r) => r.eligible === true)
      .catch(() => false);
  }

  await interaction.editReply(
    render(
      buildSignupPanel(view, actor, {
        backupEligible,
        postMessageId: options.postMessageId,
        notice: options.notice,
      }),
    ),
  );
  return view;
}

// Answers expected API failures privately; unexpected ones propagate so the
// global handler can alert ops (it replies ephemerally too).
async function answerApiError(interaction: PanelInteraction, error: unknown) {
  if (error instanceof ArtemisApiError) {
    if (error.status === 404) {
      await interaction.editReply(
        plain("I couldn't find that event. It may have been removed."),
      );
      return;
    }
    if (error.status === 400 || error.status === 403 || error.status === 409) {
      await interaction.editReply(plain(userFacingError(error)));
      return;
    }
  }
  throw error;
}

export async function handleJoin(
  interaction: PanelInteraction,
  eventId: string,
  deps: PanelDeps,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const postMessageId = publicPostHint(interaction);
  try {
    const view = await deps.api.getMySignup(eventId, interaction.user.id);
    if (!view.actions.join) {
      await loadPanel(interaction, eventId, deps, { view, postMessageId });
      return;
    }
    await interaction.editReply(
      render(buildJoinChoice(view, interaction.user.id, { postMessageId })),
    );
  } catch (error) {
    await answerApiError(interaction, error);
  }
}

export async function handleMySignup(
  interaction: PanelInteraction,
  eventId: string,
  deps: PanelDeps,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    await loadPanel(interaction, eventId, deps, {
      postMessageId: publicPostHint(interaction),
    });
  } catch (error) {
    await answerApiError(interaction, error);
  }
}

export async function handleRunTable(
  interaction: PanelInteraction,
  eventId: string,
  deps: PanelDeps,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const view = await deps.api.getMySignup(eventId, interaction.user.id);
    await interaction.editReply(render(buildRunTableMessage(view)));
  } catch (error) {
    await answerApiError(interaction, error);
  }
}

const NOT_YOURS =
  "This panel belongs to someone else. Use **My signup** on the event post to open your own.";

export async function handlePanelAction(
  interaction: PanelInteraction,
  route: PanelRoute,
  deps: PanelDeps,
): Promise<void> {
  const actor = interaction.user.id;

  // Identity comes from the interaction; the bound actor in the ID can only
  // refuse, never grant. No network call happens on this path.
  if (route.actorId !== actor) {
    await interaction.reply({
      content: NOT_YOURS,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Only our private panel may be edited with participant data. A stale or
  // misplaced panel ID on a public message must receive a new private reply.
  if (!isEphemeralSource(interaction)) {
    await interaction.reply({
      content: "Open My signup on the event post to get a fresh private panel.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await interaction.deferUpdate();
  const { eventId } = route;
  const postMessageId = route.postMessageId;
  const refreshSource: PostRefreshSource = {
    hintedMessageId: postMessageId,
    channelId: interaction.channelId,
    sourceIsEphemeral: true,
    interactionMessage: interaction.message,
  };
  const panelOptions = (notice?: string) => ({ notice, postMessageId });

  try {
    const view = await deps.api.getMySignup(eventId, actor);

    switch (route.action) {
      case "refresh":
      case "keep":
        await loadPanel(interaction, eventId, deps, { view, postMessageId });
        return;

      case "pick": {
        if (!view.actions.join) {
          await loadPanel(interaction, eventId, deps, {
            view,
            ...panelOptions("Nothing was changed."),
          });
          return;
        }
        const category = view.event.categories.find(
          (c) => c.value === route.category,
        );
        if (!category) {
          await interaction.editReply(
            render(
              buildJoinChoice(view, actor, {
                postMessageId,
                notice: "That option is no longer available.",
              }),
            ),
          );
          return;
        }
        await deps.api.rsvp(eventId, {
          discordUserId: actor,
          displayName: memberDisplayName(interaction),
          selectedCategory: category.value,
          source: "discord",
          memberDiscordRoleIds: extractMemberRoleIds(interaction.member),
        });
        await loadPanel(interaction, eventId, deps, {
          ...panelOptions("You're signed up."),
        });
        await deps.refreshPublicPost(eventId, refreshSource);
        return;
      }

      case "cancel": {
        if (!view.actions.cancel) {
          await loadPanel(interaction, eventId, deps, {
            view,
            ...panelOptions("Nothing was changed."),
          });
          return;
        }
        await interaction.editReply(
          render(buildCancelConfirm(view, actor, { postMessageId })),
        );
        return;
      }

      case "cancel_yes": {
        if (!view.actions.cancel) {
          const notice =
            view.participation.state === "GM"
              ? "Nothing was changed."
              : "You're not currently signed up, so there is nothing to cancel.";
          await loadPanel(interaction, eventId, deps, {
            view,
            ...panelOptions(notice),
          });
          return;
        }
        try {
          await deps.api.cancelRsvp(eventId, actor);
        } catch (error) {
          if (error instanceof ArtemisApiError && error.status === 404) {
            await interaction.editReply(
              plain(
                "You don't have an active signup to cancel for this event.",
              ),
            );
            return;
          }
          throw error;
        }
        await loadPanel(interaction, eventId, deps, {
          ...panelOptions(
            "Your signup has been cancelled. Any guests you added were removed too.",
          ),
        });
        await deps.refreshPublicPost(eventId, refreshSource);
        return;
      }

      case "backup": {
        if (!view.actions.addBackup) {
          await loadPanel(interaction, eventId, deps, {
            view,
            ...panelOptions("Nothing was changed."),
          });
          return;
        }
        const roleIds = extractMemberRoleIds(interaction.member);
        const eligibility = await deps.api.checkEligibility(eventId, {
          discordUserId: actor,
          memberDiscordRoleIds: roleIds,
          signupRole: "BACKUP_DM",
        });
        if (!eligibility.eligible) {
          await loadPanel(interaction, eventId, deps, {
            view,
            ...panelOptions(
              eligibility.reason ??
                "You are not eligible for this signup option.",
            ),
          });
          return;
        }
        // Explicit opt-in. Re-sends the player's own category so the RSVP
        // upsert does not reset it.
        await deps.api.rsvp(eventId, {
          discordUserId: actor,
          displayName: memberDisplayName(interaction),
          selectedCategory:
            view.participation.category ?? view.event.categories[0]?.value,
          signupRole: "BACKUP_DM",
          source: "discord",
          memberDiscordRoleIds: roleIds,
        });
        await loadPanel(interaction, eventId, deps, {
          ...panelOptions(
            `Backup ${view.event.hostLabel} availability added. You keep your player signup.`,
          ),
        });
        await deps.refreshPublicPost(eventId, refreshSource);
        return;
      }
    }
  } catch (error) {
    await answerApiError(interaction, error);
  }
}
