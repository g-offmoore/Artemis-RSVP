import {
  ActionRowBuilder,
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
} from "discord.js";
import {
  EventDateTimeInputError,
  parseBackupDmCustomId,
  parseEventDateTimeParts,
} from "@artemis/domain";
import pino from "pino";
import { ArtemisApi, ArtemisApiError } from "./api.js";
import { loadConfig } from "./config.js";
import { runDiscordOpsCheck } from "./discord-ops.js";

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
  await registerCommands();
});

client.on("error", (error) => logger.error({ error }, "Discord client error"));
client.on("shardError", (error) =>
  logger.error({ error }, "Discord shard error"),
);

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      await handleCommand(interaction);
      return;
    }

    if (interaction.isButton()) {
      await handleButton(interaction);
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

async function registerCommands() {
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

  await client.application?.commands.set(
    [eventCommand.toJSON(), opsCommand.toJSON()],
    config.DISCORD_GUILD_ID,
  );
  logger.info("Slash commands registered");
}

async function handleCommand(interaction: ChatInputCommandInteraction) {
  if (interaction.commandName === "ops") {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "check") {
      await runDiscordOpsCheck(interaction);
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
    const guildId = interaction.guildId ?? config.DISCORD_GUILD_ID;
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
    const created = await api.createEvent(payload);
    const event = await api.getEvent(created.id);
    await interaction.editReply({
      embeds: [eventEmbed(event)],
      components: [eventButtons(event)],
    });
    return;
  }

  if (subcommand === "list") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const events = await api.getEvents(
      interaction.guildId ?? config.DISCORD_GUILD_ID,
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

async function handleButton(interaction: Interaction & { customId: string }) {
  if (!interaction.isButton()) return;
  const [action, eventId, category] = interaction.customId.split(":");

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
    });
    await interaction.editReply({
      content: vocabulary.usesDndCategories
        ? `RSVP recorded as ${formatCategory(selectedCategory)}. Use Guests if you are bringing anyone with you.`
        : "RSVP recorded. Use Guests if you are bringing anyone with you.",
    });
    await refreshEventMessage(interaction, eventId);
    return;
  }

  if (action === "guest") {
    const modal = new ModalBuilder()
      .setCustomId(`guest-modal:${eventId}`)
      .setTitle("Add Guests")
      .addComponents(
        new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("guestNames")
            .setLabel("Guest names after you RSVP")
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder("One name per line, up to 3 guests")
            .setRequired(false),
        ),
      );
    await interaction.showModal(modal);
    return;
  }

  if (action === "dm" || action === "host") {
    const event = await api.getEvent(eventId);
    const vocabulary = eventVocabulary(event);
    const modal = new ModalBuilder()
      .setCustomId(`host-modal:${eventId}`)
      .setTitle(`${vocabulary.hostSingular} Signup`);
    const components: ActionRowBuilder<ModalActionRowComponentBuilder>[] = [
      new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("tableTitle")
          .setLabel("Table title")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder(`${vocabulary.hostSingular}'s Table`)
          .setRequired(false),
      ),
    ];

    if (vocabulary.usesDndCategories) {
      components.push(
        new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("tableType")
            .setLabel("Table type")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("Mixed, Normal, or Heroic")
            .setRequired(false),
        ),
      );
    }

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
          .setLabel(`${vocabulary.hostSingular} notes`)
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false),
      ),
    );
    modal.addComponents(...components);
    await interaction.showModal(modal);
    return;
  }

  if (action === "assignment") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const event = await api.getEvent(eventId);
    const participant = event.participants?.find(
      (item: any) => item.discordUserId === interaction.user.id,
    );
    const assignment = event.assignments?.find(
      (item: any) =>
        item.eventParticipantId === participant?.id &&
        (item.status === "ASSIGNED" || item.status === "PROJECTED_SEATED" || item.status === "CONFIRMED_SEATED"),
    );
    const table = event.tables?.find(
      (item: any) => item.id === assignment?.eventTableId,
    );
    await interaction.editReply({
      content: table
        ? `Your current table assignment is **${table.title}**. Staff may adjust assignments before the event locks.`
        : "You do not have a table assignment yet.",
    });
    return;
  }

  // Backup DM accept / decline buttons — sent via Discord DM by the message worker.
  const parsed = parseBackupDmCustomId(interaction.customId);
  if (parsed) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (parsed.action === "accept") {
      await api.backupDmAction(parsed.eventId, {
        actorDiscordId: interaction.user.id,
        participantId: parsed.participantId,
        action: "pull",
      });

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

async function handleModal(interaction: Interaction & { customId: string }) {
  if (!interaction.isModalSubmit()) return;
  const [action, eventId] = interaction.customId.split(":");
  if (action === "guest-modal") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const rawNames = interaction.fields.getTextInputValue("guestNames") ?? "";
    const guests = rawNames
      .split(/[\n,]+/)
      .map((name) => name.trim())
      .filter(Boolean)
      .slice(0, 3)
      .map((displayName) => ({ displayName }));

    await api.updateGuests(eventId, interaction.user.id, guests);
    await interaction.editReply({
      content: guests.length
        ? `Guest list updated. Guests recorded: ${guests.length}.`
        : "Guest list cleared.",
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
    });

    await interaction.editReply({
      content: `${vocabulary.hostSingular} registration recorded: ${table.title} (${formatTableType(table.tableType, vocabulary)}, ${table.softCap}/${table.hardCap}).`,
    });
    await refreshEventMessage(interaction, eventId);
  }
}

function eventEmbed(event: any) {
  const counts = eventCounts(event);
  const capacity = eventCapacity(event);
  const vocabulary = eventVocabulary(event);
  const embed = new EmbedBuilder()
    .setTitle(event.title)
    .setDescription(event.description ?? "Store event")
    .addFields(
      {
        name: "When",
        value: formatDiscordTimeRange(event.startAt, event.endAt),
      },
      {
        name: "Registered",
        value: `${vocabulary.attendeePlural}: ${counts.players}\nGuests: ${counts.guests}\n${vocabulary.hostPlural}: ${counts.hosts}`,
        inline: true,
      },
      {
        name: "Capacity",
        value: capacity.hardCap
          ? `${counts.players + counts.guests}/${capacity.hardCap} seats\n${capacity.tables} tables`
          : `No ${vocabulary.hostSingular.toLowerCase()} tables yet`,
        inline: true,
      },
      { name: "Status", value: event.status ?? "SCHEDULED", inline: true },
      { name: "Event ID", value: event.id, inline: true },
    );

  if (event.imageUrl) {
    embed.setImage(event.imageUrl);
  }

  return embed;
}

function eventButtons(event: any) {
  const vocabulary = eventVocabulary(event);
  const buttons = vocabulary.usesDndCategories
    ? [
        new ButtonBuilder()
          .setCustomId(`rsvp:${event.id}:NORMAL`)
          .setLabel("RSVP Normal")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`rsvp:${event.id}:HEROIC`)
          .setLabel("RSVP Heroic")
          .setStyle(ButtonStyle.Primary),
      ]
    : [
        new ButtonBuilder()
          .setCustomId(`rsvp:${event.id}:MIXED`)
          .setLabel("RSVP")
          .setStyle(ButtonStyle.Success),
      ];

  buttons.push(
    new ButtonBuilder()
      .setCustomId(`guest:${event.id}`)
      .setLabel("Guests")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`host:${event.id}`)
      .setLabel(vocabulary.hostButtonLabel)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`assignment:${event.id}`)
      .setLabel("My Assignment")
      .setStyle(ButtonStyle.Secondary),
  );

  return new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);
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

async function refreshEventMessage(interaction: Interaction, eventId: string) {
  const event = await api.getEvent(eventId);
  const message = interaction.isButton()
    ? interaction.message
    : interaction.isModalSubmit()
      ? (interaction as any).message
      : null;
  await message
    ?.edit({ embeds: [eventEmbed(event)], components: [eventButtons(event)] })
    .catch((error: unknown) => {
      logger.warn({ error, eventId }, "Could not refresh event message");
    });
}

function eventCounts(event: any) {
  const participants = Array.isArray(event.participants)
    ? event.participants.filter(
        (participant: any) => participant.assignmentEligible !== false,
      )
    : [];
  const tables = activeTables(event);
  return {
    players: participants.filter(
      (participant: any) => participant.participantType === "PRIMARY",
    ).length,
    guests: participants.filter(
      (participant: any) => participant.participantType === "GUEST",
    ).length,
    hosts: tables.length,
  };
}

function eventCapacity(event: any) {
  const tables = activeTables(event);
  return {
    tables: tables.length,
    softCap: tables.reduce(
      (sum: number, table: any) => sum + (table.softCap ?? 0),
      0,
    ),
    hardCap: tables.reduce(
      (sum: number, table: any) => sum + (table.hardCap ?? 0),
      0,
    ),
  };
}

function activeTables(event: any) {
  return Array.isArray(event.tables)
    ? event.tables.filter(
        (table: any) => !["CANCELLED", "COMPLETED"].includes(table.status),
      )
    : [];
}

function formatDiscordTimeRange(startAt: string, endAt: string) {
  return `${formatDiscordTimestamp(startAt, "F")} to ${formatDiscordTimestamp(endAt, "t")}\n${formatDiscordTimestamp(startAt, "R")}`;
}

function formatDiscordTimestamp(value: string, style: "F" | "R" | "t") {
  return `<t:${Math.floor(new Date(value).getTime() / 1000)}:${style}>`;
}

function formatCategory(category: string) {
  return category.charAt(0).toUpperCase() + category.slice(1).toLowerCase();
}

function eventVocabulary(event: { gameSystem?: string }) {
  const gameSystem = event.gameSystem?.trim().toLowerCase() ?? "";
  if (
    gameSystem === "d&d" ||
    gameSystem === "dnd" ||
    gameSystem.includes("dungeons")
  ) {
    return {
      usesDndCategories: true,
      attendeePlural: "Players",
      hostSingular: "DM",
      hostPlural: "DMs",
      hostButtonLabel: "DM Signup",
    };
  }

  if (gameSystem === "daggerheart") {
    return {
      usesDndCategories: false,
      attendeePlural: "Attendees",
      hostSingular: "GM",
      hostPlural: "GMs",
      hostButtonLabel: "GM Signup",
    };
  }

  return {
    usesDndCategories: false,
    attendeePlural: "Attendees",
    hostSingular: "Ambassador",
    hostPlural: "Ambassadors",
    hostButtonLabel: "Ambassador Signup",
  };
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

function userFacingError(error: unknown) {
  if (error instanceof ArtemisApiError) {
    if (error.status === 404 && /RSVP not found/i.test(error.responseBody)) {
      return "RSVP first, then add guests.";
    }
    if (error.status === 400) {
      return (
        apiValidationMessage(error.responseBody) ??
        "Artemis could not save that because part of the request was not valid."
      );
    }
  }

  return "Artemis could not complete that action. Staff has been notified if alerts are configured.";
}

function apiValidationMessage(responseBody: string) {
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

async function handleOpsSettings(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guildId = interaction.guildId ?? config.DISCORD_GUILD_ID;
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
  const guildId = interaction.guildId ?? config.DISCORD_GUILD_ID;
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
  const guildId = interaction.guildId ?? config.DISCORD_GUILD_ID;
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
