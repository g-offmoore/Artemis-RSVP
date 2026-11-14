import {
  ActionRowBuilder,
  ButtonInteraction,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ChatInputCommandInteraction,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  Interaction,
  MessageFlags,
  ModalActionRowComponentBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} from "discord.js";
import {
  EventDateTimeInputError,
  parseBackupDmCustomId,
  parseEventDateTimeParts,
} from "@artemis/domain";
import pino from "pino";
import { ArtemisApi, ArtemisApiError, withGuildContext } from "./api.js";
import { loadConfig } from "./config.js";
import {
  parseButtonCustomId,
  STALE_BUTTON_MESSAGE,
  type ButtonRoute,
} from "./custom-ids.js";
import { runDiscordOpsCheck } from "./discord-ops.js";
import {
  eventButtons,
  eventEmbed,
  eventVocabulary,
  formatDiscordTimestamp,
} from "./event-post.js";
import { extractMemberRoleIds, userFacingError } from "./interaction-utils.js";
import {
  handleJoin,
  handleMySignup,
  handlePanelAction,
  handleRunTable,
  type PanelDeps,
  type PanelInteraction,
} from "./panel-handlers.js";
import { refreshPublicPost, type PostRefreshSource } from "./public-post.js";

const config = loadConfig();
const DEFAULT_EVENT_TIME_ZONE =
  process.env.ARTEMIS_EVENT_TIME_ZONE ?? "America/New_York";

// 5-minute in-memory cache so every /event create doesn't hit the API
const guildSettingsCache = new Map<
  string,
  { timezone: string; channelId?: string; fetchedAt: number }
>();
const GUILD_SETTINGS_TTL_MS = 5 * 60 * 1000;

async function getGuildTimezone(guildId: string): Promise<string> {
  const cached = guildSettingsCache.get(guildId);
  if (cached && Date.now() - cached.fetchedAt < GUILD_SETTINGS_TTL_MS) {
    return cached.timezone;
  }
  try {
    const settings = (await api.getGuildSettings(guildId)) as {
      defaultTimezone?: string;
      defaultEventChannelId?: string;
    };
    const entry = {
      timezone: settings.defaultTimezone ?? DEFAULT_EVENT_TIME_ZONE,
      channelId: settings.defaultEventChannelId ?? undefined,
      fetchedAt: Date.now(),
    };
    guildSettingsCache.set(guildId, entry);
    return entry.timezone;
  } catch {
    return DEFAULT_EVENT_TIME_ZONE;
  }
}
const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "DISCORD_TOKEN",
    "INTERNAL_API_TOKEN",
    "req.headers.authorization",
    "token",
    "*.token",
  ],
  // pino only serializes Error objects under `err` by default; call sites here
  // log them as `error`, which otherwise renders as `{}` with no message/stack.
  serializers: { error: pino.stdSerializers.err },
});
const api = new ArtemisApi(config);
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
  ],
});

client.once(Events.ClientReady, async () => {
  logger.info({ user: client.user?.tag }, "Discord bot logged in");
  // Backfill command registration and refresh the stored guild name for every
  // guild the bot is already in, covering restarts, renames, and the
  // pre-multi-guild production install. New installs are handled by the
  // guildCreate handler below.
  for (const guild of client.guilds.cache.values()) {
    await registerCommandsForGuild(guild.id);
    await refreshGuildName(guild.id, guild.name);
  }
});

client.on(Events.GuildCreate, async (guild) => {
  logger.info({ guildId: guild.id, name: guild.name }, "Bot joined a new guild");
  await onboardGuild(guild.id);
  await refreshGuildName(guild.id, guild.name);
});

client.on("error", (error) => logger.error({ error }, "Discord client error"));
client.on("shardError", (error, shardId) =>
  logger.error({ error, shardId }, "Discord shard error"),
);

client.on("interactionCreate", async (interaction) => {
  await withGuildContext(interaction.guildId, async () => {
    try {
      if (interaction.isChatInputCommand()) {
        await handleCommand(interaction);
        return;
      }

      if (interaction.isButton()) {
        await handleButton(interaction);
        return;
      }

      if (interaction.isUserSelectMenu()) {
        await handleUserSelectMenu(interaction);
        return;
      }

      if (interaction.isModalSubmit()) {
        await handleModal(interaction);
      }
    } catch (error) {
      logger.error({ error }, "Interaction failed");
      await replySafely(interaction, userFacingError(error));
      await sendOpsAlert("Discord interaction failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
});

function buildCommands() {
  const eventCommand = new SlashCommandBuilder()
    .setName("event")
    .setDescription("Manage Artemis events")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("create")
        .setDescription("Create a store event")
        .addStringOption((option) =>
          option.setName("name").setDescription("Event name").setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("date")
            .setDescription("Event date, like 2026-06-18 or 6/18/2026")
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("start_time")
            .setDescription("Start time, like 18:00, 6:00 PM, or 1700")
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("end_time")
            .setDescription("End time, like 22:00, 10:00 PM, or 2200")
            .setRequired(true),
        )
        .addStringOption((option) =>
          option.setName("description").setDescription("Event description"),
        )
        .addAttachmentOption((option) =>
          option.setName("image").setDescription("Event graphic or poster"),
        )
        .addStringOption((option) =>
          option
            .setName("game")
            .setDescription("Game or event system")
            .addChoices(
              { name: "D&D", value: "D&D" },
              { name: "Daggerheart", value: "Daggerheart" },
              { name: "Board Game", value: "Board Game" },
            ),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("list").setDescription("List upcoming events"),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("cancel")
        .setDescription("Cancel an event")
        .addStringOption((option) =>
          option.setName("id").setDescription("Event ID").setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("assign")
        .setDescription("Run table assignment")
        .addStringOption((option) =>
          option.setName("id").setDescription("Event ID").setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("table")
        .setDescription("Sign up to host a table")
        .addStringOption((option) =>
          option
            .setName("event_id")
            .setDescription("Event ID")
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("type")
            .setDescription("D&D table type")
            .addChoices(
              { name: "Normal", value: "NORMAL" },
              { name: "Heroic", value: "HEROIC" },
              { name: "Mixed", value: "MIXED" },
            ),
        )
        .addIntegerOption((option) =>
          option
            .setName("soft_cap")
            .setDescription("Preferred table size")
            .setMinValue(1)
            .setMaxValue(20),
        )
        .addIntegerOption((option) =>
          option
            .setName("hard_cap")
            .setDescription("Maximum table size")
            .setMinValue(1)
            .setMaxValue(20),
        )
        .addStringOption((option) =>
          option.setName("title").setDescription("Optional table title"),
        ),
    );

  const opsCommand = new SlashCommandBuilder()
    .setName("ops")
    .setDescription("Artemis operational checks")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("check")
        .setDescription("Run Discord permission and delivery checks"),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("settings")
        .setDescription("Show current Artemis guild settings"),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("set-event-channel")
        .setDescription("Set the default channel for event Discord posts")
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("Channel to post event embeds in")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("set-timezone")
        .setDescription(
          "Set the guild timezone for event times (e.g. America/Chicago)",
        )
        .addStringOption((option) =>
          option
            .setName("timezone")
            .setDescription("IANA timezone, e.g. America/New_York or America/Los_Angeles")
            .setRequired(true),
        ),
    );

  return [eventCommand.toJSON(), opsCommand.toJSON()];
}

/**
 * Registers slash commands into a single guild. Called reactively on guildCreate (new
 * install) and once at startup for every guild the bot is already in, so commands are
 * available immediately rather than waiting on global-command propagation (~1hr).
 */
async function registerCommandsForGuild(guildId: string) {
  await client.application?.commands.set(buildCommands(), guildId);
  logger.info({ guildId }, "Slash commands registered for guild");
}

async function refreshGuildName(guildId: string, name: string) {
  try {
    await withGuildContext(guildId, () => api.updateGuildSettings(guildId, { name }));
  } catch (error) {
    logger.warn({ error, guildId }, "Failed to refresh stored guild name");
  }
}

async function onboardGuild(guildId: string) {
  try {
    await registerCommandsForGuild(guildId);
    await withGuildContext(guildId, () => api.onboardGuild(guildId));
    logger.info({ guildId }, "Guild onboarded");
  } catch (error) {
    logger.error({ error, guildId }, "Guild onboarding failed");
    await sendOpsAlert("Guild onboarding failed", {
      guildId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Every command/button/select/modal Artemis handles is guild-only by registration, so
 * interaction.guildId should always be populated. Throwing here (rather than falling
 * back to some default guild) fails closed and is caught by the top-level
 * interactionCreate handler, which replies ephemerally and alerts ops.
 */
function requireGuildId(interaction: { guildId: string | null }): string {
  if (!interaction.guildId) {
    throw new Error("This action is only available inside a Discord server.");
  }
  return interaction.guildId;
}

async function handleCommand(interaction: ChatInputCommandInteraction) {
  if (interaction.commandName === "ops") {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "check") {
      await runDiscordOpsCheck(interaction, api, requireGuildId(interaction));
      return;
    }
    if (subcommand === "settings") {
      await handleOpsSettings(interaction);
      return;
    }
    if (subcommand === "set-event-channel") {
      await handleOpsSetEventChannel(interaction);
      return;
    }
    if (subcommand === "set-timezone") {
      await handleOpsSetTimezone(interaction);
      return;
    }
    return;
  }

  if (interaction.commandName !== "event") return;

  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "create") {
    const guildId = requireGuildId(interaction);
    const timeZone = await getGuildTimezone(guildId);
    let startAt: Date;
    let endAt: Date;
    try {
      startAt = parseEventDateTimeParts(
        interaction.options.getString("date", true),
        interaction.options.getString("start_time", true),
        timeZone,
      );
      endAt = parseEventDateTimeParts(
        interaction.options.getString("date", true),
        interaction.options.getString("end_time", true),
        timeZone,
      );
      if (endAt <= startAt) {
        endAt = new Date(endAt.getTime() + 24 * 60 * 60 * 1000);
      }
    } catch (error) {
      const message =
        error instanceof EventDateTimeInputError
          ? error.message
          : "The date or time was not valid.";
      await interaction.reply({
        content: `${message} Example: date 2026-06-18, start 6:00 PM, end 10:00 PM.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Defer publicly — the success reply IS the event post in the channel.
    // Errors must be made ephemeral so failures never appear publicly
    // (rules.md §4.2, §12.3: event creation failures are private).
    await interaction.deferReply();
    const image = interaction.options.getAttachment("image");
    const payload = {
      guildId,
      channelId: interaction.channelId,
      title: interaction.options.getString("name", true),
      description: interaction.options.getString("description") ?? undefined,
      imageUrl: image?.url,
      gameSystem: interaction.options.getString("game") ?? "D&D",
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      createdByDiscordId: interaction.user.id,
    };
    try {
      const created = await api.createEvent(payload);
      const event = await api.getEvent(created.id);
      await interaction.editReply({
        embeds: [eventEmbed(event)],
        components: eventButtons(event),
      });
    } catch (createError) {
      // Delete the non-ephemeral deferred reply so the error is not left
      // visible in the channel, then respond ephemerally to the creator only.
      await interaction.deleteReply().catch(() => undefined);
      await interaction
        .followUp({
          content: userFacingError(createError),
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => undefined);
      await sendOpsAlert("Event creation failed", {
        error: createError instanceof Error ? createError.message : String(createError),
        userId: interaction.user.id,
        guildId,
      });
    }
    return;
  }

  if (subcommand === "list") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const events = await api.getEvents(
      requireGuildId(interaction),
    );
    if (!Array.isArray(events) || events.length === 0) {
      await interaction.editReply({ content: "No upcoming events." });
      return;
    }

    await interaction.editReply({
      content: events.slice(0, 10).map(formatEventListItem).join("\n"),
    });
    return;
  }

  if (subcommand === "cancel") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const id = interaction.options.getString("id", true);
    await api.cancelEvent(id, interaction.user.id);
    await interaction.editReply({ content: `Cancelled event ${id}.` });
    return;
  }

  if (subcommand === "assign") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const id = interaction.options.getString("id", true);
    const result = await api.runAssignments(id, interaction.user.id);
    await interaction.editReply({
      content: formatAssignmentResult(result),
    });
    return;
  }

  if (subcommand === "table") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const eventId = interaction.options.getString("event_id", true);
    const event = await api.getEvent(eventId);
    const vocabulary = eventVocabulary(event);
    const table = await api.createTable(eventId, {
      ambassadorDiscordId: interaction.user.id,
      ambassadorDisplayName:
        interaction.member && "displayName" in interaction.member
          ? interaction.member.displayName
          : interaction.user.username,
      title: interaction.options.getString("title") ?? undefined,
      tableType: vocabulary.usesDndCategories
        ? (interaction.options.getString("type") ?? "MIXED")
        : "MIXED",
      softCap: interaction.options.getInteger("soft_cap") ?? 6,
      hardCap: interaction.options.getInteger("hard_cap") ?? 7,
    });
    await interaction.editReply({
      content: `${vocabulary.hostSingular} registration recorded: ${table.title} (${formatTableType(table.tableType, vocabulary)}, ${table.softCap}/${table.hardCap}).`,
    });
  }
}

// Public post controls (Join / Run a table / My signup) and the ephemeral
// personal panel. Legacy IDs from already-posted messages keep routing to the
// original handlers below.
const panelDeps: PanelDeps = {
  api,
  refreshPublicPost: (eventId, source) => refreshCanonicalPost(eventId, source),
};

async function handleButton(interaction: Interaction & { customId: string }) {
  if (!interaction.isButton()) return;
  const route = parseButtonCustomId(interaction.customId);
  if (!route) {
    await interaction.reply({
      content: STALE_BUTTON_MESSAGE,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const panelInteraction: PanelInteraction = interaction;
  switch (route.kind) {
    case "join":
      await handleJoin(panelInteraction, route.eventId, panelDeps);
      return;
    case "my_signup":
      await handleMySignup(panelInteraction, route.eventId, panelDeps);
      return;
    case "run_table":
      await handleRunTable(panelInteraction, route.eventId, panelDeps);
      return;
    case "panel":
      await handlePanelAction(panelInteraction, route, panelDeps);
      return;
    case "backup_dm_response":
      await handleBackupDmResponse(interaction);
      return;
    case "legacy":
      await handleLegacyButton(interaction, route);
      return;
  }
}

async function handleLegacyButton(
  interaction: ButtonInteraction,
  route: Extract<ButtonRoute, { kind: "legacy" }>,
) {
  const { action, eventId, category } = route;

  if (action === "rsvp") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const event = await api.getEvent(eventId);
    const vocabulary = eventVocabulary(event);
    const selectedCategory = vocabulary.usesDndCategories
      ? (category ?? "NORMAL")
      : "MIXED";
    await api.rsvp(eventId, {
      discordUserId: interaction.user.id,
      displayName:
        interaction.member && "displayName" in interaction.member
          ? interaction.member.displayName
          : interaction.user.username,
      selectedCategory,
      source: "discord",
      memberDiscordRoleIds: extractMemberRoleIds(interaction.member),
    });
    await interaction.editReply({
      content: vocabulary.usesDndCategories
        ? `You're registered as ${formatCategory(selectedCategory)}. Use the Guests button if you're bringing anyone.`
        : "You're registered for this event. Use the Guests button if you're bringing anyone.",
    });
    await refreshEventMessage(interaction, eventId);
    return;
  }

  if (action === "guest") {
    // Two-path guest flow: Discord member picker OR text name entry for non-Discord guests.
    // API enforces the real per-RSVP guest limit; UI cap is permissive.
    // The public post id is only carried when this click came from the public
    // post itself (not from the ephemeral My signup panel).
    const publicPostId =
      interaction.message.flags.has(MessageFlags.Ephemeral)
        ? ""
        : interaction.message.id;
    const menu = new UserSelectMenuBuilder()
      .setCustomId(`guest-select:${eventId}:${publicPostId}`)
      .setPlaceholder("Select your complete Discord guest list")
      .setMinValues(0)
      .setMaxValues(10);
    const nameBtn = new ButtonBuilder()
      .setCustomId(`guest_text:${eventId}`)
      .setLabel("Replace guests with names (non-Discord)")
      .setStyle(ButtonStyle.Secondary);
    await interaction.reply({
      content:
        "Replace your entire guest list: select all Discord guests to keep, or enter the complete list by name. This replaces previous guests, not appends to them. Select nobody to clear the list.",
      components: [
        new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(menu),
        new ActionRowBuilder<ButtonBuilder>().addComponents(nameBtn),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === "guest_text") {
    const modal = new ModalBuilder()
      .setCustomId(`guest-name-modal:${eventId}`)
      .setTitle("Replace Guest List by Name");
    modal.addComponents(
      new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("guestNames")
          .setLabel("Complete guest list (one per line, up to 10)")
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder("Jane Doe\nJohn Smith")
          .setRequired(true)
          .setMaxLength(500),
      ),
    );
    await interaction.showModal(modal);
    return;
  }

  // §7.5, §11.7: Player seating preferences — sit with/avoid specific players, and
  // prefer/avoid a specific DM/ambassador. All are soft hints, staff/admin-visible
  // only, and influence assignment only after hard
  // constraints, eligibility, and capacity are satisfied.
  if (action === "prefs") {
    // TODO(product-feedback): Preferences should support configurable targets
    // such as persistent table, game system, play category, and preferred
    // players. Campaign continuity currently comes from RSVP campaignId.
    const preferPlayerMenu = new UserSelectMenuBuilder()
      .setCustomId(`pref-prefer-player:${eventId}`)
      .setPlaceholder("Players I'd like to sit with")
      .setMinValues(0)
      .setMaxValues(5);
    const avoidPlayerMenu = new UserSelectMenuBuilder()
      .setCustomId(`pref-avoid-player:${eventId}`)
      .setPlaceholder("Players I'd prefer to avoid sitting with")
      .setMinValues(0)
      .setMaxValues(5);
    const preferDmMenu = new UserSelectMenuBuilder()
      .setCustomId(`pref-prefer-dm:${eventId}`)
      .setPlaceholder("DM I'd like to have")
      .setMinValues(0)
      .setMaxValues(1);
    const avoidDmMenu = new UserSelectMenuBuilder()
      .setCustomId(`pref-avoid-dm:${eventId}`)
      .setPlaceholder("DM I'd prefer to avoid")
      .setMinValues(0)
      .setMaxValues(1);
    await interaction.reply({
      content:
        "**Preferences** — these are soft hints, not guarantees, and are only visible to staff.\n" +
        "Players: who you'd like to sit with, or avoid. DM: who you'd like to have run your table, or avoid.",
      components: [
        new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(preferPlayerMenu),
        new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(avoidPlayerMenu),
        new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(preferDmMenu),
        new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(avoidDmMenu),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === "dm" || action === "host") {
    // TODO(product-feedback): Host signup modals should be generated from
    // event/series configuration so each program can ask its own questions.
    // A modal is the initial acknowledgment: do not wait on the API first.
    // System-specific category handling and eligibility are checked on submit.
    const modal = new ModalBuilder()
      .setCustomId(`host-modal:${eventId}`)
      .setTitle("Run a table");
    const components: ActionRowBuilder<ModalActionRowComponentBuilder>[] = [
      new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("tableTitle")
          .setLabel("Table title")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("My Table")
          .setRequired(false),
      ),
    ];

    components.push(
      new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("tableType")
          .setLabel("D&D type (ignored for other systems)")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("Mixed, Normal, or Heroic")
          .setRequired(false),
      ),
    );

    components.push(
      new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("softCap")
          .setLabel("Preferred table size")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("6")
          .setRequired(false),
      ),
      new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("hardCap")
          .setLabel("Maximum table size")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("7")
          .setRequired(false),
      ),
      new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("description")
          .setLabel("Table notes")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false),
      ),
    );
    modal.addComponents(...components);
    await interaction.showModal(modal);
    return;
  }

  // Cancel RSVP (rules.md §7.4: every registered user must have a clear cancel action).
  if (action === "cancel_rsvp") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      await api.cancelRsvp(eventId, interaction.user.id);
      await interaction.editReply({
        content: "Your RSVP has been cancelled. You are no longer registered for this event.",
      });
      await refreshEventMessage(interaction, eventId);
    } catch (cancelError) {
      const msg = cancelError instanceof ArtemisApiError && cancelError.status === 404
        ? "You don't have an active RSVP to cancel for this event."
        : userFacingError(cancelError);
      await interaction.editReply({ content: msg });
    }
    return;
  }

  // Backup DM signup (rules.md §5.4: Backup DM must be a first-class Discord UI path).
  if (action === "backup_dm") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const event = await api.getEvent(eventId);
    const vocabulary = eventVocabulary(event);
    const displayName =
      interaction.member && "displayName" in interaction.member
        ? interaction.member.displayName
        : interaction.user.username;
    try {
      await api.rsvp(eventId, {
        discordUserId: interaction.user.id,
        displayName,
        selectedCategory: vocabulary.usesDndCategories ? "NORMAL" : "MIXED",
        signupRole: "BACKUP_DM",
        source: "discord",
        memberDiscordRoleIds: extractMemberRoleIds(interaction.member),
      });
      await interaction.editReply({
        content:
          "Backup DM availability registered. You remain eligible for a player seat. " +
          "If a DM is needed and you are selected, you will receive a DM asking for your consent.",
      });
      await refreshEventMessage(interaction, eventId);
    } catch (backupErr) {
      await interaction.editReply({ content: userFacingError(backupErr) });
    }
    return;
  }

  // Legacy "My Assignment" buttons on already-posted messages now open the
  // participant-safe My signup panel. The old handler read the whole event
  // payload and named a table for projected (unreleased) assignments.
  if (action === "assignment") {
    await handleMySignup(interaction, eventId, panelDeps);
    return;
  }
}

// Backup DM accept / decline buttons — sent via Discord DM by the message worker.
async function handleBackupDmResponse(interaction: ButtonInteraction) {
  const parsed = parseBackupDmCustomId(interaction.customId);
  if (parsed) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (parsed.action === "accept") {
      const result = await api.backupDmAction(parsed.eventId, {
        actorDiscordId: interaction.user.id,
        participantId: parsed.participantId,
        action: "pull",
      }) as { alreadySettled?: boolean; slotAlreadyFilled?: boolean };

      if (result?.slotAlreadyFilled || result?.alreadySettled) {
        await interaction.editReply({
          content:
            "Another backup DM already accepted before you — the slot is filled. Your player RSVP is unchanged. Thank you for being willing to step up!",
        });
        return;
      }

      await interaction.editReply({
        content:
          "✅ You have been assigned as DM. Your player seat has been released. Thank you for stepping up!",
      });

      await sendOpsAlert("Backup DM accepted", {
        eventId: parsed.eventId,
        discordUserId: interaction.user.id,
        participantId: parsed.participantId,
      });
      return;
    }

    if (parsed.action === "decline") {
      await api.backupDmAction(parsed.eventId, {
        actorDiscordId: interaction.user.id,
        participantId: parsed.participantId,
        action: "decline",
      });

      await interaction.editReply({
        content:
          "Your decline has been recorded. Your player RSVP is unchanged. Organizers will find another backup DM.",
      });

      await sendOpsAlert("Backup DM declined", {
        eventId: parsed.eventId,
        discordUserId: interaction.user.id,
        participantId: parsed.participantId,
      });
      return;
    }
  }
}

async function handleUserSelectMenu(interaction: Interaction) {
  if (!interaction.isUserSelectMenu()) return;
  const parts = interaction.customId.split(":");

  if (parts[0] === "guest-select") {
    const eventId = parts[1];
    const originalMessageId = parts[2];
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const guests = [...interaction.users.values()].map((user) => {
      const member = interaction.members.get(user.id);
      const displayName =
        member && "displayName" in member ? (member as any).displayName : user.username;
      return { discordUserId: user.id, displayName };
    });
    await api.updateGuests(eventId, interaction.user.id, guests);
    await interaction.editReply({
      content: guests.length
        ? `Guest list updated. ${guests.length} guest(s) recorded.`
        : "Guest list cleared.",
    });
    await refreshCanonicalPost(eventId, {
      hintedMessageId: originalMessageId || undefined,
      channelId: interaction.channelId,
      sourceIsEphemeral: true,
    });
    return;
  }

  if (
    parts[0] === "pref-prefer-player" ||
    parts[0] === "pref-avoid-player" ||
    parts[0] === "pref-prefer-dm" ||
    parts[0] === "pref-avoid-dm"
  ) {
    const eventId = parts[1];
    const preferenceType =
      parts[0] === "pref-prefer-player"
        ? "PREFER_PLAYER"
        : parts[0] === "pref-avoid-player"
          ? "AVOID_PLAYER"
          : parts[0] === "pref-prefer-dm"
            ? "PREFER_DM"
            : "AVOID_DM";
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const selected = [...interaction.users.keys()];
    if (selected.length === 0) {
      await interaction.editReply({ content: "No preferences changed." });
      return;
    }
    await Promise.all(
      selected.map((targetUserId) =>
        api.setPreference(eventId, {
          userId: interaction.user.id,
          preferenceType,
          targetUserId,
          strength: "SOFT",
        }),
      ),
    );
    const labels: Record<string, string> = {
      PREFER_PLAYER: "sit-with",
      AVOID_PLAYER: "avoid",
      PREFER_DM: "preferred DM",
      AVOID_DM: "avoided DM",
    };
    const noun = preferenceType.endsWith("_DM") ? "DM" : "player";
    await interaction.editReply({
      content: `Preference (${labels[preferenceType]}) saved for ${selected.length} ${noun}(s).`,
    });
    return;
  }
}

async function handleModal(interaction: Interaction & { customId: string }) {
  if (!interaction.isModalSubmit()) return;
  const [action, eventId] = interaction.customId.split(":");

  if (action === "guest-name-modal") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const namesRaw = interaction.fields.getTextInputValue("guestNames");
    const guests = namesRaw
      .split("\n")
      .map((n) => n.trim())
      .filter(Boolean)
      .slice(0, 10)
      .map((displayName) => ({ displayName }));
    if (guests.length === 0) {
      await interaction.editReply({ content: "No guest names entered." });
      return;
    }
    await api.updateGuests(eventId, interaction.user.id, guests);
    await interaction.editReply({
      content: `Guest list replaced with ${guests.length} guest(s): ${guests.map((g) => g.displayName).join(", ")}.`,
    });
    await refreshEventMessage(interaction, eventId);
    return;
  }

  if (action === "dm-modal" || action === "host-modal") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const event = await api.getEvent(eventId);
    const vocabulary = eventVocabulary(event);
    const tableType = vocabulary.usesDndCategories
      ? normalizeTableType(
          interaction.fields.getTextInputValue("tableType") || "MIXED",
        )
      : "MIXED";
    if (!tableType) {
      await interaction.editReply({
        content: "Table type must be Normal, Heroic, or Mixed.",
      });
      return;
    }
    const softCap = parseCap(
      interaction.fields.getTextInputValue("softCap"),
      6,
    );
    const hardCap = parseCap(
      interaction.fields.getTextInputValue("hardCap"),
      Math.max(softCap, 7),
    );
    if (hardCap < softCap) {
      await interaction.editReply({
        content:
          "Maximum table size must be greater than or equal to preferred table size.",
      });
      return;
    }

    const table = await api.createTable(eventId, {
      ambassadorDiscordId: interaction.user.id,
      ambassadorDisplayName:
        interaction.member && "displayName" in interaction.member
          ? interaction.member.displayName
          : interaction.user.username,
      title: optionalModalValue(interaction, "tableTitle"),
      tableType,
      softCap,
      hardCap,
      description: optionalModalValue(interaction, "description"),
      memberDiscordRoleIds: extractMemberRoleIds(interaction.member),
    });

    await interaction.editReply({
      content: `${vocabulary.hostSingular} registration recorded: ${table.title} (${formatTableType(table.tableType, vocabulary)}, ${table.softCap}/${table.hardCap}).`,
    });
    await refreshEventMessage(interaction, eventId);
  }
}

async function replySafely(interaction: Interaction, content: string) {
  if (!interaction.isRepliable()) return;
  if (interaction.deferred && !interaction.replied) {
    await interaction.editReply({ content }).catch(() => undefined);
    return;
  }
  if (interaction.replied) {
    await interaction
      .followUp({ content, flags: MessageFlags.Ephemeral })
      .catch(() => undefined);
    return;
  }
  await interaction
    .reply({ content, flags: MessageFlags.Ephemeral })
    .catch(() => undefined);
}

function formatEventListItem(event: any) {
  return `- **${event.title}** (${event.id}) - ${formatDiscordTimestamp(event.startAt, "F")} - ${event._count?.participants ?? 0} attending, ${
    event._count?.tables ?? 0
  } tables`;
}

function formatAssignmentResult(result: any) {
  const warnings = Array.isArray(result.warnings) ? result.warnings : [];
  const warningText = warnings.length
    ? `\nWarnings:\n${warnings
        .slice(0, 5)
        .map((warning: any) => `- ${warning.message}`)
        .join("\n")}`
    : "";
  return `Assignment complete. Decisions: ${result.decisions?.length ?? 0}. Warnings: ${warnings.length}.${warningText}`;
}

// Refreshes the CANONICAL public event post (see public-post.ts). Never edits
// the clicked message blindly: from an ephemeral panel that message is the
// participant's private panel, not the public post.
function refreshCanonicalPost(eventId: string, source: PostRefreshSource) {
  return refreshPublicPost(
    {
      getEvent: (id) => api.getEvent(id),
      fetchMessage: async (channelId, messageId) => {
        const channel = await client.channels.fetch(channelId);
        if (!channel || !channel.isTextBased()) return null;
        return channel.messages.fetch(messageId).catch(() => null);
      },
      render: (event) => ({
        embeds: [eventEmbed(event)],
        components: eventButtons(event),
      }),
      warn: (message, details) => logger.warn(details ?? {}, message),
    },
    eventId,
    source,
  );
}

function refreshEventMessage(interaction: Interaction, eventId: string) {
  const message =
    interaction.isButton() || interaction.isModalSubmit()
      ? ((interaction as { message?: unknown }).message ?? null)
      : null;
  const flags = (message as { flags?: { has(flag: number): boolean } } | null)
    ?.flags;
  return refreshCanonicalPost(eventId, {
    channelId: interaction.channelId,
    sourceIsEphemeral: Boolean(flags?.has(MessageFlags.Ephemeral)),
    interactionMessage: message,
  });
}

function formatCategory(category: string) {
  return category.charAt(0).toUpperCase() + category.slice(1).toLowerCase();
}

function formatTableType(
  tableType: string,
  vocabulary: ReturnType<typeof eventVocabulary>,
) {
  return vocabulary.usesDndCategories ? formatCategory(tableType) : "Open";
}

function normalizeTableType(raw: string) {
  const value = raw.trim().toUpperCase();
  if (value === "NORMAL" || value === "HEROIC" || value === "MIXED")
    return value;
  return null;
}

function parseCap(raw: string, fallback: number) {
  const parsed = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalModalValue(
  interaction: { fields: { getTextInputValue(customId: string): string } },
  customId: string,
) {
  const value = interaction.fields.getTextInputValue(customId).trim();
  return value || undefined;
}

async function handleOpsSettings(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guildId = requireGuildId(interaction);
  const settings = (await api.getGuildSettings(guildId)) as {
    defaultTimezone?: string;
    defaultEventChannelId?: string;
    staffRoleIds?: string[];
    adminRoleIds?: string[];
    feedbackFormUrl?: string;
  };

  const embed = new EmbedBuilder()
    .setTitle("Artemis Guild Settings")
    .addFields(
      {
        name: "Timezone",
        value: settings.defaultTimezone ?? "America/New_York (default)",
        inline: true,
      },
      {
        name: "Event channel",
        value: settings.defaultEventChannelId
          ? `<#${settings.defaultEventChannelId}>`
          : "Not set",
        inline: true,
      },
      {
        name: "Staff roles",
        value:
          settings.staffRoleIds?.length
            ? settings.staffRoleIds.map((id) => `<@&${id}>`).join(", ")
            : "Not configured",
        inline: false,
      },
      {
        name: "Feedback form",
        value: settings.feedbackFormUrl ?? "Not set",
        inline: false,
      },
    );

  await interaction.editReply({ embeds: [embed] });
}

async function handleOpsSetEventChannel(
  interaction: ChatInputCommandInteraction,
) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guildId = requireGuildId(interaction);
  const channel = interaction.options.getChannel("channel", true);
  await api.updateGuildSettings(guildId, {
    defaultEventChannelId: channel.id,
  });
  guildSettingsCache.delete(guildId);
  await interaction.editReply({
    content: `Event channel set to <#${channel.id}>. New events will post there by default.`,
  });
}

async function handleOpsSetTimezone(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guildId = requireGuildId(interaction);
  const timezone = interaction.options.getString("timezone", true).trim();

  // Validate IANA timezone before sending to API
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
  } catch {
    await interaction.editReply({
      content: `"${timezone}" is not a valid timezone. Use an IANA name like \`America/New_York\`, \`America/Chicago\`, or \`America/Los_Angeles\`.`,
    });
    return;
  }

  await api.updateGuildSettings(guildId, { defaultTimezone: timezone });
  guildSettingsCache.delete(guildId);
  await interaction.editReply({
    content: `Timezone set to \`${timezone}\`. New events will use this timezone.`,
  });
}

async function sendOpsAlert(
  message: string,
  details?: Record<string, unknown>,
) {
  if (!config.DISCORD_OPS_WEBHOOK_URL) return;
  await fetch(config.DISCORD_OPS_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      content: `Artemis bot alert: ${message}`,
      embeds: details
        ? [{ description: JSON.stringify(details).slice(0, 3500) }]
        : undefined,
    }),
  }).catch(() => undefined);
}

client.login(config.DISCORD_TOKEN).catch((error) => {
  logger.fatal({ error }, "Discord login failed");
  process.exit(1);
});
