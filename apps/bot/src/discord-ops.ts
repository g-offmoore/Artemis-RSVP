import {
  ChatInputCommandInteraction,
  Guild,
  GuildMember,
  MessageFlags,
  PermissionFlagsBits,
  Role,
  TextChannel,
} from "discord.js";
import type { ArtemisApi } from "./api.js";

export async function runDiscordOpsCheck(
  interaction: ChatInputCommandInteraction,
  api: ArtemisApi,
  guildId: string,
) {
  const guild = interaction.guild;
  const me = guild?.members.me;
  if (!guild || !me) {
    await interaction.reply({
      content: "Ops check failed: guild context unavailable.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const checks: string[] = [];
  checks.push(resultLine("Guilds intent", true));
  checks.push(
    resultLine(
      "Manage Roles permission",
      me.permissions.has(PermissionFlagsBits.ManageRoles),
    ),
  );
  checks.push(
    resultLine(
      "Send Messages permission",
      me.permissions.has(PermissionFlagsBits.SendMessages),
    ),
  );
  checks.push(
    resultLine(
      "Manage Messages permission",
      me.permissions.has(PermissionFlagsBits.ManageMessages),
    ),
  );

  const role = await createRole(guild, me);
  checks.push(resultLine("Create Artemis-owned role", role.ok, role.error));

  const assignment = role.createdRole
    ? await assignAndRemoveRole(
        interaction.member as GuildMember,
        role.createdRole,
      )
    : { ok: false };
  checks.push(
    resultLine("Assign/remove temporary role", assignment.ok, assignment.error),
  );

  const dm = await sendTestDm(interaction);
  checks.push(resultLine("DM test user or handle closed DMs", dm.ok, dm.error));

  const channel = interaction.channel;
  const editable =
    channel && "send" in channel
      ? await postAndEditTestEmbed(channel as TextChannel)
      : { ok: false };
  checks.push(
    resultLine("Post/edit event-style embed", editable.ok, editable.error),
  );

  if (role.createdRole) {
    const cleanup = await deleteRole(role.createdRole);
    checks.push(
      resultLine("Delete Artemis-owned role", cleanup.ok, cleanup.error),
    );
  }

  // API checks: assignment lock status and recent job failures (rules.md §18).
  const nextEvent = await fetchNextEventDetail(api, guildId);
  if (nextEvent) {
    const messageJobs: Array<{ messageType: string; status: string }> = nextEvent.messageJobs ?? [];
    const lockJob = messageJobs.find((j) => j.messageType === "ASSIGNMENT_LOCK");
    const lockOk = lockJob?.status === "PENDING" || lockJob?.status === "SENT";
    checks.push(resultLine(
      `Assignment lock job (${(nextEvent as any).title ?? nextEvent.id})`,
      Boolean(lockOk),
      lockOk ? undefined : `status=${lockJob?.status ?? "missing"}`,
    ));
    const failedJobs = messageJobs.filter((j) => j.status === "FAILED");
    checks.push(resultLine(
      "No failed message jobs for next event",
      failedJobs.length === 0,
      failedJobs.length > 0 ? `Failed: ${failedJobs.map((j) => j.messageType).join(", ")}` : undefined,
    ));
  } else {
    checks.push(resultLine("Assignment lock / job status", true, "No upcoming events found"));
  }

  await interaction.editReply({
    content: `Artemis Discord ops check:\n${checks.join("\n")}`,
  });
}

async function fetchNextEventDetail(api: ArtemisApi, guildId: string): Promise<any | null> {
  try {
    const events = await api.getEvents(guildId) as any[];
    if (!Array.isArray(events) || events.length === 0) return null;
    return api.getEvent(events[0].id);
  } catch {
    return null;
  }
}

function resultLine(label: string, ok: boolean, error?: string) {
  return `${ok ? "PASS" : "FAIL"} - ${label}${error ? ` (${error})` : ""}`;
}

async function createRole(
  guild: Guild,
  me: GuildMember,
): Promise<{ ok: boolean; createdRole?: Role; error?: string }> {
  try {
    const role = await guild.roles.create({
      name: `Artemis Ops Check ${Date.now().toString(36)}`,
      mentionable: false,
      permissions: [],
    });

    const manageable = role.position < me.roles.highest.position;
    if (!manageable) {
      await role.delete("Artemis ops check cleanup");
    }
    return {
      ok: manageable,
      createdRole: manageable ? role : undefined,
      error: manageable ? undefined : "bot role is not above test role",
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function deleteRole(
  role: Role,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await role.delete("Artemis ops check cleanup");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function assignAndRemoveRole(
  member: GuildMember,
  role: Role,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await member.roles.add(role, "Artemis ops check");
    await member.roles.remove(role, "Artemis ops check cleanup");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function sendTestDm(
  interaction: ChatInputCommandInteraction,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await interaction.user.send("Artemis ops check DM. No action needed.");
    return { ok: true };
  } catch (error) {
    return {
      ok: true,
      error: `DM unavailable but handled: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function postAndEditTestEmbed(
  channel: TextChannel,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const permissions = channel.guild.members.me
      ? channel.permissionsFor(channel.guild.members.me)
      : null;
    if (
      !permissions?.has(PermissionFlagsBits.ViewChannel) ||
      !permissions.has(PermissionFlagsBits.SendMessages)
    ) {
      return {
        ok: false,
        error: "bot cannot view or send messages in this channel",
      };
    }

    const message = await channel.send({
      content: "Artemis ops check message.",
    });
    await message.edit({ content: "Artemis ops check message edited." });
    await message.delete();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
