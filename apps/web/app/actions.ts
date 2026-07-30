"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  EventDateTimeInputError,
  parseEventDateTimeParts,
} from "@artemis/domain";
import { artemisApi } from "../src/lib/artemis-api";
import { requireSession } from "../src/lib/auth";

export type ActionState = {
  ok: boolean;
  message: string;
};

const emptyState: ActionState = { ok: false, message: "" };
const defaultEventTimeZone =
  process.env.ARTEMIS_EVENT_TIME_ZONE ?? "America/New_York";

export async function createEventAction(
  _state: ActionState = emptyState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();

  // Accept an explicit guildId from the form (new guild picker) but validate it
  // server-side — never trust the client to assert which guilds the user may write to.
  const submittedGuildId = valueOf(formData, "guildId");
  const guildId = resolveAuthorizedGuildId(session, submittedGuildId);
  if (!guildId) return { ok: false, message: "Not authorized for that guild." };

  const channelId =
    valueOf(formData, "channelId") || process.env.DISCORD_EVENT_CHANNEL_ID;
  let eventId = "";

  if (!channelId)
    return {
      ok: false,
      message: "Select a channel or set DISCORD_EVENT_CHANNEL_ID.",
    };

  try {
    const timeZone =
      valueOf(formData, "timezone") || defaultEventTimeZone;
    const startAt = parseEventDateTimeParts(
      valueOf(formData, "date"),
      valueOf(formData, "startTime"),
      timeZone,
    );
    let endAt = parseEventDateTimeParts(
      valueOf(formData, "date"),
      valueOf(formData, "endTime"),
      timeZone,
    );
    if (endAt <= startAt)
      endAt = new Date(endAt.getTime() + 24 * 60 * 60 * 1000);

    const event = await artemisApi<{ id: string }>("/api/v1/events", {
      method: "POST",
      guildId,
      body: {
        guildId,
        channelId,
        title: valueOf(formData, "title"),
        description: optionalValueOf(formData, "description"),
        imageUrl: optionalValueOf(formData, "imageUrl"),
        gameSystem: valueOf(formData, "gameSystem") || "D&D",
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        createdByDiscordId: session.discordUserId,
        eventType: buildEventTypeOverrides(formData),
      },
    });
    eventId = event.id;
    await artemisApi(`/api/v1/events/${event.id}/publish`, {
      method: "POST",
      guildId,
      body: { actorDiscordId: session.discordUserId },
    });
  } catch (error) {
    if (eventId) {
      revalidatePath("/");
      revalidatePath(`/events/${eventId}`);
      return {
        ok: false,
        message: `Event created (${eventId}), but Discord posting failed: ${actionErrorMessage(error)}`,
      };
    }
    return { ok: false, message: actionErrorMessage(error) };
  }

  revalidatePath("/");
  redirect(`/events/${eventId}`);
}

export async function createRecurringEventAction(
  _state: ActionState = emptyState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();

  const submittedGuildId = valueOf(formData, "guildId");
  const guildId = resolveAuthorizedGuildId(session, submittedGuildId);
  if (!guildId) return { ok: false, message: "Not authorized for that guild." };

  const channelId =
    valueOf(formData, "channelId") || process.env.DISCORD_EVENT_CHANNEL_ID;
  if (!channelId) return { ok: false, message: "Select a channel or set DISCORD_EVENT_CHANNEL_ID." };

  const weekday = valueOf(formData, "weekday") || "FRI";
  const intervalWeeks = valueOf(formData, "intervalWeeks") === "2" ? 2 : 1;
  const recurrenceRule = intervalWeeks === 2 ? `WEEKLY:${weekday}:2` : `WEEKLY:${weekday}`;

  let seriesId: string;
  try {
    const series = await artemisApi<{ id: string }>("/api/v1/series", {
      method: "POST",
      guildId,
      body: {
        guildId,
        name: valueOf(formData, "title"),
        defaultChannelId: channelId,
        recurrenceRule,
        defaultGameSystem: valueOf(formData, "gameSystem") || "D&D",
        defaultStartHour: parseInt(valueOf(formData, "startTime").split(":")[0] ?? "18", 10),
        defaultStartMinute: parseInt(valueOf(formData, "startTime").split(":")[1] ?? "0", 10),
        defaultDurationMinutes: parseInt(valueOf(formData, "durationMinutes") || "240", 10),
        defaultDescription: optionalValueOf(formData, "description"),
        defaultImageUrl: optionalValueOf(formData, "imageUrl"),
        createdByDiscordId: session.discordUserId,
        eventType: buildEventTypeOverrides(formData),
      },
    });
    seriesId = series.id;

    // Generate + publish the first occurrence so "create recurring event" is as
    // quick as creating a one-off — the series page handles future generation.
    const generated = await artemisApi<{ events: Array<{ id: string }> }>(
      `/api/v1/series/${seriesId}/generate`,
      { method: "POST", guildId, body: { count: 1 } },
    );
    if (generated.events[0]) {
      await artemisApi(`/api/v1/events/${generated.events[0].id}/publish`, {
        method: "POST",
        guildId,
        body: { actorDiscordId: session.discordUserId },
      });
    }
  } catch (error) {
    return { ok: false, message: actionErrorMessage(error) };
  }

  revalidatePath("/");
  revalidatePath("/series");
  redirect(`/series/${seriesId}`);
}

export async function updateEventAction(
  _state: ActionState = emptyState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();
  const eventId = valueOf(formData, "eventId");

  try {
    const timeZone =
      valueOf(formData, "timezone") || defaultEventTimeZone;
    const date = valueOf(formData, "date");
    const startAt = date
      ? parseEventDateTimeParts(date, valueOf(formData, "startTime"), timeZone)
      : undefined;
    let endAt = date
      ? parseEventDateTimeParts(date, valueOf(formData, "endTime"), timeZone)
      : undefined;
    if (startAt && endAt && endAt <= startAt)
      endAt = new Date(endAt.getTime() + 24 * 60 * 60 * 1000);

    const shortageAlertRaw = optionalValueOf(formData, "shortageAlertHoursBefore");
    await artemisApi(`/api/v1/events/${eventId}`, {
      method: "PATCH",
      guildId: session.activeGuildId,
      body: {
        title: optionalValueOf(formData, "title"),
        description: valueOf(formData, "description") || null,
        imageUrl: valueOf(formData, "imageUrl") || null,
        gameSystem: optionalValueOf(formData, "gameSystem"),
        startAt: startAt?.toISOString(),
        endAt: endAt?.toISOString(),
        shortageAlertHoursBefore: shortageAlertRaw ? parseInt(shortageAlertRaw, 10) : null,
        actorDiscordId: session.discordUserId,
        applyToFuture: valueOf(formData, "applyToFuture") === "true",
      },
    });
  } catch (error) {
    return { ok: false, message: actionErrorMessage(error) };
  }

  revalidatePath(`/events/${eventId}`);
  return { ok: true, message: "Event updated." };
}

export async function createSeriesAction(
  _state: ActionState = emptyState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();
  const guildId = session.activeGuildId;

  let seriesId: string;
  try {
    const defaultChannelId =
      valueOf(formData, "defaultChannelId") || process.env.DISCORD_EVENT_CHANNEL_ID || "";
    if (!defaultChannelId)
      return { ok: false, message: "Set DISCORD_EVENT_CHANNEL_ID or enter a channel ID." };

    const series = await artemisApi<{ id: string }>("/api/v1/series", {
      method: "POST",
      guildId,
      body: {
        guildId,
        name: valueOf(formData, "name"),
        defaultChannelId,
        recurrenceRule: `WEEKLY:${valueOf(formData, "weekday")}`,
        defaultGameSystem: valueOf(formData, "gameSystem") || "D&D",
        defaultStartHour: parseInt(valueOf(formData, "startHour") || "18", 10),
        defaultStartMinute: parseInt(valueOf(formData, "startMinute") || "0", 10),
        defaultDurationMinutes: parseInt(valueOf(formData, "durationMinutes") || "240", 10),
        createdByDiscordId: session.discordUserId,
      },
    });
    seriesId = series.id;
  } catch (error) {
    return { ok: false, message: actionErrorMessage(error) };
  }

  revalidatePath("/series");
  redirect(`/series/${seriesId}`);
}

export async function generateOccurrencesAction(
  _state: ActionState = emptyState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();
  const seriesId = valueOf(formData, "seriesId");
  const count = parseInt(valueOf(formData, "count") || "4", 10);

  try {
    const result = await artemisApi<{ created: number; events: Array<{ id: string; startAt: string }> }>(
      `/api/v1/series/${seriesId}/generate`,
      { method: "POST", guildId: session.activeGuildId, body: { count } },
    );
    revalidatePath(`/series/${seriesId}`);
    revalidatePath("/");
    return { ok: true, message: `Generated ${result.created} event(s).` };
  } catch (error) {
    return { ok: false, message: actionErrorMessage(error) };
  }
}

export async function runAssignmentsAction(
  _state: ActionState = emptyState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();
  const eventId = valueOf(formData, "eventId");

  try {
    const result = await artemisApi<{
      decisions?: unknown[];
      warnings?: unknown[];
    }>(`/api/v1/events/${eventId}/assignments/run`, {
      method: "POST",
      guildId: session.activeGuildId,
      body: { actorDiscordId: session.discordUserId },
    });
    revalidatePath(`/events/${eventId}`);
    return {
      ok: true,
      message: `Assignment complete. Decisions: ${result.decisions?.length ?? 0}. Warnings: ${result.warnings?.length ?? 0}.`,
    };
  } catch (error) {
    return { ok: false, message: actionErrorMessage(error) };
  }
}

export async function publishDiscordPostAction(
  _state: ActionState = emptyState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();
  const eventId = valueOf(formData, "eventId");

  try {
    const result = await artemisApi<{ channelId: string; messageId: string }>(
      `/api/v1/events/${eventId}/publish`,
      {
        method: "POST",
        guildId: session.activeGuildId,
        body: { actorDiscordId: session.discordUserId },
      },
    );
    revalidatePath(`/events/${eventId}`);
    return {
      ok: true,
      message: `Discord post ready: ${result.channelId}/${result.messageId}.`,
    };
  } catch (error) {
    return { ok: false, message: actionErrorMessage(error) };
  }
}

export async function cancelEventAction(
  _state: ActionState = emptyState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();
  const eventId = valueOf(formData, "eventId");

  try {
    await artemisApi(`/api/v1/events/${eventId}`, {
      method: "DELETE",
      guildId: session.activeGuildId,
      body: { actorDiscordId: session.discordUserId },
    });
    revalidatePath("/");
    revalidatePath(`/events/${eventId}`);
    return { ok: true, message: "Event cancelled." };
  } catch (error) {
    return { ok: false, message: actionErrorMessage(error) };
  }
}

export async function lockAssignmentsAction(
  _state: ActionState = emptyState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();
  const eventId = valueOf(formData, "eventId");

  try {
    const result = await artemisApi<{ lockedAt: string; decisions: number; warnings: unknown[] }>(
      `/api/v1/events/${eventId}/assignments/lock`,
      {
        method: "POST",
        guildId: session.activeGuildId,
        body: {
          actorDiscordId: session.discordUserId,
          reason: optionalValueOf(formData, "reason"),
        },
      },
    );
    revalidatePath(`/events/${eventId}`);
    return {
      ok: true,
      message: `Assignments locked. ${result.decisions} confirmed. Warnings: ${result.warnings?.length ?? 0}.`,
    };
  } catch (error) {
    return { ok: false, message: actionErrorMessage(error) };
  }
}

export async function backupDmActionAction(
  _state: ActionState = emptyState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();
  const eventId = valueOf(formData, "eventId");
  const participantId = valueOf(formData, "participantId");
  const action = valueOf(formData, "action") as "pull" | "release" | "decline";

  try {
    await artemisApi(`/api/v1/events/${eventId}/backup-dm/action`, {
      method: "POST",
      guildId: session.activeGuildId,
      body: {
        actorDiscordId: session.discordUserId,
        participantId,
        action,
        reason: optionalValueOf(formData, "reason"),
      },
    });
    revalidatePath(`/events/${eventId}`);
    const labels = { pull: "pulled to DM", release: "released", decline: "marked declined" };
    return { ok: true, message: `Backup DM ${labels[action] ?? action}.` };
  } catch (error) {
    return { ok: false, message: actionErrorMessage(error) };
  }
}

export async function retryEventRoleAction(
  _state: ActionState = emptyState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();
  const eventId = valueOf(formData, "eventId");
  try {
    const result = await artemisApi<{ ok: boolean; discordRoleId?: string; error?: string }>(
      `/api/v1/events/${eventId}/roles/retry`,
      { method: "POST", guildId: session.activeGuildId },
    );
    revalidatePath(`/events/${eventId}`);
    if (result.ok) {
      return { ok: true, message: `Discord role created: ${result.discordRoleId}` };
    }
    return { ok: false, message: result.error ?? "Role creation failed." };
  } catch (error) {
    return { ok: false, message: actionErrorMessage(error) };
  }
}

export async function updateSettingsAction(
  _state: ActionState = emptyState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();
  const guildId = session.activeGuildId;

  const parseIds = (key: string) =>
    valueOf(formData, key)
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

  try {
    await artemisApi(`/api/v1/guild-settings/${guildId}`, {
      method: "PATCH",
      guildId,
      body: {
        defaultTimezone: optionalValueOf(formData, "defaultTimezone"),
        defaultEventChannelId: optionalValueOf(formData, "defaultEventChannelId"),
        feedbackFormUrl: valueOf(formData, "feedbackFormUrl") || null,
        staffRoleIds: parseIds("staffRoleIds"),
        adminRoleIds: parseIds("adminRoleIds"),
        ambassadorRoleIds: parseIds("ambassadorRoleIds"),
        normalRoleIds: parseIds("normalRoleIds"),
        heroicRoleIds: parseIds("heroicRoleIds"),
        temporaryRoleCleanupDays: valueOf(formData, "temporaryRoleCleanupDays")
          ? parseInt(valueOf(formData, "temporaryRoleCleanupDays"), 10)
          : undefined,
      },
    });
  } catch (error) {
    return { ok: false, message: actionErrorMessage(error) };
  }

  revalidatePath("/settings");
  return { ok: true, message: "Settings saved." };
}

export async function registerAmbassadorAction(
  _state: ActionState = emptyState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();
  const guildId = session.activeGuildId;

  try {
    await artemisApi("/api/v1/ambassadors", {
      method: "POST",
      guildId,
      body: {
        guildId,
        discordUserId: valueOf(formData, "discordUserId"),
        displayName: valueOf(formData, "displayName"),
        supportedGameSystems: valueOf(formData, "supportedGameSystems")
          .split(/[\n,]+/)
          .map((s) => s.trim())
          .filter(Boolean),
        defaultSoftCap: parseInt(valueOf(formData, "defaultSoftCap") || "6", 10),
        defaultHardCap: parseInt(valueOf(formData, "defaultHardCap") || "7", 10),
        defaultTableType: valueOf(formData, "defaultTableType") || "MIXED",
        notes: optionalValueOf(formData, "notes"),
      },
    });
  } catch (error) {
    return { ok: false, message: actionErrorMessage(error) };
  }

  revalidatePath("/ambassadors");
  return { ok: true, message: "Ambassador registered." };
}

export async function updateAmbassadorAction(
  _state: ActionState = emptyState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();
  const ambassadorId = valueOf(formData, "ambassadorId");

  try {
    await artemisApi(`/api/v1/ambassadors/${ambassadorId}`, {
      method: "PATCH",
      guildId: session.activeGuildId,
      body: {
        displayName: optionalValueOf(formData, "displayName"),
        supportedGameSystems: valueOf(formData, "supportedGameSystems")
          ? valueOf(formData, "supportedGameSystems")
              .split(/[\n,]+/)
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined,
        defaultSoftCap: valueOf(formData, "defaultSoftCap")
          ? parseInt(valueOf(formData, "defaultSoftCap"), 10)
          : undefined,
        defaultHardCap: valueOf(formData, "defaultHardCap")
          ? parseInt(valueOf(formData, "defaultHardCap"), 10)
          : undefined,
        defaultTableType: optionalValueOf(formData, "defaultTableType"),
        active: valueOf(formData, "active") === "true",
        notes: valueOf(formData, "notes") || null,
        dmCountLast30Days: valueOf(formData, "dmCountLast30Days")
          ? parseInt(valueOf(formData, "dmCountLast30Days"), 10)
          : undefined,
        backupPullCountLast90Days: valueOf(formData, "backupPullCountLast90Days")
          ? parseInt(valueOf(formData, "backupPullCountLast90Days"), 10)
          : undefined,
        lastDmDate: valueOf(formData, "lastDmDate") || null,
      },
    });
  } catch (error) {
    return { ok: false, message: actionErrorMessage(error) };
  }

  revalidatePath(`/ambassadors/${ambassadorId}`);
  revalidatePath("/ambassadors");
  return { ok: true, message: "Ambassador updated." };
}

export async function deregisterAmbassadorAction(
  _state: ActionState = emptyState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();
  const ambassadorId = valueOf(formData, "ambassadorId");

  try {
    await artemisApi(`/api/v1/ambassadors/${ambassadorId}`, {
      method: "DELETE",
      guildId: session.activeGuildId,
    });
  } catch (error) {
    return { ok: false, message: actionErrorMessage(error) };
  }

  revalidatePath("/ambassadors");
  redirect("/ambassadors");
}

export async function upsertEligibilityRuleAction(
  _state: ActionState = emptyState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();
  const eventId = valueOf(formData, "eventId");
  const parseIds = (key: string) =>
    valueOf(formData, key)
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

  try {
    await artemisApi(`/api/v1/events/${eventId}/eligibility/rules`, {
      method: "POST",
      guildId: session.activeGuildId,
      body: {
        signupRole: valueOf(formData, "signupRole"),
        allowedDiscordRoleIds: parseIds("allowedDiscordRoleIds"),
        requiredDiscordRoleIds: parseIds("requiredDiscordRoleIds"),
        deniedDiscordRoleIds: parseIds("deniedDiscordRoleIds"),
        requiresApproval: valueOf(formData, "requiresApproval") === "true",
      },
    });
  } catch (error) {
    return { ok: false, message: actionErrorMessage(error) };
  }

  revalidatePath(`/events/${eventId}`);
  return { ok: true, message: "Eligibility rule saved." };
}

export async function removeRsvpAction(
  _state: ActionState = emptyState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();
  const eventId = valueOf(formData, "eventId");
  const discordUserId = valueOf(formData, "discordUserId");

  try {
    await artemisApi(`/api/v1/events/${eventId}/rsvps/${discordUserId}`, {
      method: "DELETE",
      guildId: session.activeGuildId,
      body: { actorDiscordId: session.discordUserId },
    });
  } catch (error) {
    return { ok: false, message: actionErrorMessage(error) };
  }

  revalidatePath(`/events/${eventId}`);
  return { ok: true, message: "RSVP removed." };
}

export async function confirmAttendanceAction(
  _state: ActionState = emptyState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();
  const eventId = valueOf(formData, "eventId");

  const participantIds = formData.getAll("participantId").map(String);
  const records = participantIds.map((participantId) => ({
    eventParticipantId: participantId,
    status: valueOf(formData, `status_${participantId}`) || "ATTENDED",
    notes: optionalValueOf(formData, `notes_${participantId}`),
  }));

  try {
    await artemisApi(`/api/v1/events/${eventId}/attendance`, {
      method: "POST",
      guildId: session.activeGuildId,
      body: { actorDiscordId: session.discordUserId, records },
    });
  } catch (error) {
    return { ok: false, message: actionErrorMessage(error) };
  }

  revalidatePath(`/events/${eventId}`);
  return { ok: true, message: "Attendance recorded." };
}

export async function createTableAction(
  _state: ActionState = emptyState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();
  const eventId = valueOf(formData, "eventId");

  try {
    const gameSystem = valueOf(formData, "gameSystem");
    const vocabulary = eventVocabulary(gameSystem);
    const table = await artemisApi<{
      title: string;
      tableType: string;
      softCap: number;
      hardCap: number;
    }>(`/api/v1/events/${eventId}/tables`, {
      method: "POST",
      guildId: session.activeGuildId,
      body: {
        ambassadorDiscordId: session.discordUserId,
        ambassadorDisplayName: session.username,
        title: optionalValueOf(formData, "title"),
        tableType: vocabulary.usesDndCategories
          ? valueOf(formData, "tableType") || "MIXED"
          : "MIXED",
        softCap: valueOf(formData, "softCap") || "6",
        hardCap: valueOf(formData, "hardCap") || "7",
      },
    });
    revalidatePath(`/events/${eventId}`);
    return {
      ok: true,
      message: `${vocabulary.hostSingular} table registered: ${table.title} (${vocabulary.usesDndCategories ? table.tableType : "Open"}, ${table.softCap}/${table.hardCap}).`,
    };
  } catch (error) {
    return { ok: false, message: actionErrorMessage(error) };
  }
}

export async function updateEventTypeAction(
  _state: ActionState = emptyState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();
  const eventId = valueOf(formData, "eventId");

  try {
    await artemisApi(`/api/v1/events/${eventId}/event-type`, {
      method: "PATCH",
      guildId: session.activeGuildId,
      body: buildEventTypeOverrides(formData),
    });
  } catch (error) {
    return { ok: false, message: actionErrorMessage(error) };
  }

  revalidatePath(`/events/${eventId}`);
  return { ok: true, message: "Signup options updated." };
}

export async function updateSeriesEventTypeAction(
  _state: ActionState = emptyState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();
  const seriesId = valueOf(formData, "seriesId");

  try {
    await artemisApi(`/api/v1/series/${seriesId}/event-type`, {
      method: "PATCH",
      guildId: session.activeGuildId,
      body: buildEventTypeOverrides(formData),
    });
  } catch (error) {
    return { ok: false, message: actionErrorMessage(error) };
  }

  revalidatePath(`/series/${seriesId}`);
  return { ok: true, message: "Series signup options updated." };
}

function valueOf(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function optionalValueOf(formData: FormData, key: string) {
  const value = valueOf(formData, key);
  return value || undefined;
}

function buildEventTypeOverrides(formData: FormData) {
  // A sentinel field marks that the signup-options section was submitted.
  // Unchecked checkboxes don't appear in FormData, so without the sentinel
  // we can't distinguish "user left it unchecked" from "section not shown".
  if (!formData.has("_signupOptionsSubmitted")) return undefined;

  const checked = (key: string) => formData.get(key) !== null;
  return {
    name: optionalValueOf(formData, "eventTypeName"),
    requiresRsvp: checked("requiresRsvp"),
    allowsGuests: checked("allowsGuests"),
    maxGuestsPerRsvp: parseInt(valueOf(formData, "maxGuestsPerRsvp") || "3", 10),
    requiresAmbassadors: checked("requiresAmbassadors"),
    requiresTableAssignment: checked("requiresTableAssignment"),
    usesPlayerCategories: checked("usesPlayerCategories"),
    createsTemporaryRoles: checked("createsTemporaryRoles"),
    requiresAttendanceConfirmation: checked("requiresAttendanceConfirmation"),
    sendsFeedbackPrompts: checked("sendsFeedbackPrompts"),
    usesWaitlist: checked("usesWaitlist"),
    allowsNameOnlyWalkIns: checked("allowsNameOnlyWalkIns"),
  };
}

function resolveAuthorizedGuildId(
  session: { activeGuildId: string; isPlatformAdmin: boolean; guilds: Array<{ guildId: string }> },
  submittedGuildId: string,
): string | null {
  if (!submittedGuildId) return session.activeGuildId;
  if (session.isPlatformAdmin) return submittedGuildId;
  if (session.guilds.some((g) => g.guildId === submittedGuildId)) return submittedGuildId;
  return null;
}

function actionErrorMessage(error: unknown) {
  if (error instanceof EventDateTimeInputError) return error.message;
  if (!(error instanceof Error)) return "The action failed.";

  const validationMessage = parseApiValidationMessage(error.message);
  return validationMessage ?? error.message;
}

function parseApiValidationMessage(message: string) {
  const jsonStart = message.indexOf("{");
  if (jsonStart === -1) return undefined;

  try {
    const body = JSON.parse(message.slice(jsonStart)) as {
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

function eventVocabulary(gameSystem: string) {
  const value = gameSystem.trim().toLowerCase();
  if (value === "d&d" || value === "dnd" || value.includes("dungeons")) {
    return { usesDndCategories: true, hostSingular: "DM" };
  }
  if (value === "daggerheart") {
    return { usesDndCategories: false, hostSingular: "GM" };
  }
  return { usesDndCategories: false, hostSingular: "Ambassador" };
}
