import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  Interaction,
  ModalActionRowComponentBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
import pino from "pino";
import { ArtemisApi } from "./api.js";
import { loadConfig } from "./config.js";
import { runDiscordOpsCheck } from "./discord-ops.js";

const config = loadConfig();
const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: ["DISCORD_TOKEN", "INTERNAL_API_TOKEN", "req.headers.authorization", "token", "*.token"]
});
const api = new ArtemisApi(config);
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.DirectMessages]
});

client.once("ready", async () => {
  logger.info({ user: client.user?.tag }, "Discord bot logged in");
  await registerCommands();
});

client.on("error", (error) => logger.error({ error }, "Discord client error"));
client.on("shardError", (error) => logger.error({ error }, "Discord shard error"));

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
    await replySafely(interaction, "Artemis could not complete that action. Staff has been notified if alerts are configured.");
    await sendOpsAlert("Discord interaction failed", { error: error instanceof Error ? error.message : String(error) });
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
        .addStringOption((option) => option.setName("name").setDescription("Event name").setRequired(true))
        .addStringOption((option) => option.setName("start").setDescription("Start datetime, ISO-8601").setRequired(true))
        .addStringOption((option) => option.setName("end").setDescription("End datetime, ISO-8601").setRequired(true))
        .addStringOption((option) => option.setName("description").setDescription("Event description"))
        .addStringOption((option) =>
          option
            .setName("game")
            .setDescription("Game or event system")
            .addChoices({ name: "D&D", value: "D&D" }, { name: "Daggerheart", value: "Daggerheart" }, { name: "Board Game", value: "Board Game" })
        )
    )
    .addSubcommand((subcommand) => subcommand.setName("list").setDescription("List upcoming events"))
    .addSubcommand((subcommand) =>
      subcommand
        .setName("cancel")
        .setDescription("Cancel an event")
        .addStringOption((option) => option.setName("id").setDescription("Event ID").setRequired(true))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("assign")
        .setDescription("Run table assignment")
        .addStringOption((option) => option.setName("id").setDescription("Event ID").setRequired(true))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("table")
        .setDescription("Sign up to run a table")
        .addStringOption((option) => option.setName("event_id").setDescription("Event ID").setRequired(true))
        .addStringOption((option) =>
          option
            .setName("type")
            .setDescription("Table type")
            .setRequired(true)
            .addChoices({ name: "Normal", value: "NORMAL" }, { name: "Heroic", value: "HEROIC" }, { name: "Mixed", value: "MIXED" })
        )
        .addIntegerOption((option) => option.setName("soft_cap").setDescription("Preferred table size").setMinValue(1).setMaxValue(20))
        .addIntegerOption((option) => option.setName("hard_cap").setDescription("Maximum table size").setMinValue(1).setMaxValue(20))
        .addStringOption((option) => option.setName("title").setDescription("Optional table title"))
    );

  const opsCommand = new SlashCommandBuilder()
    .setName("ops")
    .setDescription("Artemis operational checks")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) => subcommand.setName("check").setDescription("Run Discord permission and delivery checks"));

  await client.application?.commands.set([eventCommand.toJSON(), opsCommand.toJSON()], config.DISCORD_GUILD_ID);
  logger.info("Slash commands registered");
}

async function handleCommand(interaction: ChatInputCommandInteraction) {
  if (interaction.commandName === "ops") {
    await runDiscordOpsCheck(interaction);
    return;
  }

  if (interaction.commandName !== "event") return;

  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "create") {
    const payload = {
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      title: interaction.options.getString("name", true),
      description: interaction.options.getString("description") ?? undefined,
      gameSystem: interaction.options.getString("game") ?? "D&D",
      startAt: interaction.options.getString("start", true),
      endAt: interaction.options.getString("end", true),
      createdByDiscordId: interaction.user.id
    };
    const event = await api.createEvent(payload);
    await interaction.reply({
      embeds: [eventEmbed(event)],
      components: [eventButtons(event.id)]
    });
    return;
  }

  if (subcommand === "list") {
    const events = await api.getEvents(interaction.guildId ?? config.DISCORD_GUILD_ID);
    if (!Array.isArray(events) || events.length === 0) {
      await interaction.reply({ content: "No upcoming events.", ephemeral: true });
      return;
    }

    await interaction.reply({
      content: events
        .slice(0, 10)
        .map((event: any) => `- ${event.title} (${event.id}) - ${new Date(event.startAt).toLocaleString()}`)
        .join("\n"),
      ephemeral: true
    });
    return;
  }

  if (subcommand === "cancel") {
    const id = interaction.options.getString("id", true);
    await api.cancelEvent(id, interaction.user.id);
    await interaction.reply({ content: `Cancelled event ${id}.`, ephemeral: true });
    return;
  }

  if (subcommand === "assign") {
    const id = interaction.options.getString("id", true);
    const result = await api.runAssignments(id, interaction.user.id);
    await interaction.reply({
      content: `Assignment complete. Decisions: ${result.decisions?.length ?? 0}. Warnings: ${result.warnings?.length ?? 0}.`,
      ephemeral: true
    });
    return;
  }

  if (subcommand === "table") {
    const eventId = interaction.options.getString("event_id", true);
    const table = await api.createTable(eventId, {
      ambassadorDiscordId: interaction.user.id,
      title: interaction.options.getString("title") ?? undefined,
      tableType: interaction.options.getString("type", true),
      softCap: interaction.options.getInteger("soft_cap") ?? 6,
      hardCap: interaction.options.getInteger("hard_cap") ?? 7
    });
    await interaction.reply({ content: `Table registered: ${table.title} (${table.tableType}, ${table.softCap}/${table.hardCap}).`, ephemeral: true });
  }
}

async function handleButton(interaction: Interaction & { customId: string }) {
  if (!interaction.isButton()) return;
  const [action, eventId, category] = interaction.customId.split(":");

  if (action === "rsvp") {
    await api.rsvp(eventId, {
      discordUserId: interaction.user.id,
      displayName: interaction.member && "displayName" in interaction.member ? interaction.member.displayName : interaction.user.username,
      selectedCategory: category ?? "NORMAL",
      source: "discord"
    });
    await interaction.reply({ content: `RSVP recorded as ${category ?? "NORMAL"}. Assignments may shift before the event is locked.`, ephemeral: true });
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
            .setLabel("Guest names, comma-separated or one per line")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
        )
      );
    await interaction.showModal(modal);
    return;
  }

  if (action === "assignment") {
    const event = await api.getEvent(eventId);
    const participant = event.participants?.find((item: any) => item.discordUserId === interaction.user.id);
    const assignment = event.assignments?.find((item: any) => item.eventParticipantId === participant?.id && item.status === "ASSIGNED");
    const table = event.tables?.find((item: any) => item.id === assignment?.eventTableId);
    await interaction.reply({
      content: table ? `Your current table assignment is ${table.title}. Staff may adjust assignments before the event locks.` : "You do not have a table assignment yet.",
      ephemeral: true
    });
  }
}

async function handleModal(interaction: Interaction & { customId: string }) {
  if (!interaction.isModalSubmit()) return;
  const [action, eventId] = interaction.customId.split(":");
  if (action !== "guest-modal") return;

  const rawNames = interaction.fields.getTextInputValue("guestNames") ?? "";
  const guests = rawNames
    .split(/[\n,]+/)
    .map((name) => name.trim())
    .filter(Boolean)
    .slice(0, 3)
    .map((displayName) => ({ displayName }));

  await api.updateGuests(eventId, interaction.user.id, guests);
  await interaction.reply({ content: `Guest list updated. Guests recorded: ${guests.length}.`, ephemeral: true });
}

function eventEmbed(event: any) {
  return new EmbedBuilder()
    .setTitle(event.title)
    .setDescription(event.description ?? "Store event")
    .addFields(
      { name: "When", value: `${new Date(event.startAt).toLocaleString()} to ${new Date(event.endAt).toLocaleString()}` },
      { name: "Status", value: event.status ?? "SCHEDULED", inline: true },
      { name: "Event ID", value: event.id, inline: true }
    );
}

function eventButtons(eventId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`rsvp:${eventId}:NORMAL`).setLabel("RSVP Normal").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`rsvp:${eventId}:HEROIC`).setLabel("RSVP Heroic").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`guest:${eventId}`).setLabel("Guests").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`assignment:${eventId}`).setLabel("My Assignment").setStyle(ButtonStyle.Secondary)
  );
}

async function replySafely(interaction: Interaction, content: string) {
  if (!interaction.isRepliable()) return;
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({ content, ephemeral: true }).catch(() => undefined);
    return;
  }
  await interaction.reply({ content, ephemeral: true }).catch(() => undefined);
}

async function sendOpsAlert(message: string, details?: Record<string, unknown>) {
  if (!config.DISCORD_OPS_WEBHOOK_URL) return;
  await fetch(config.DISCORD_OPS_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: `Artemis bot alert: ${message}`, embeds: details ? [{ description: JSON.stringify(details).slice(0, 3500) }] : undefined })
  }).catch(() => undefined);
}

client.login(config.DISCORD_TOKEN).catch((error) => {
  logger.fatal({ error }, "Discord login failed");
  process.exit(1);
});
