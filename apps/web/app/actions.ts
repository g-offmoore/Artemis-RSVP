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
  const guildId = process.env.DISCORD_GUILD_ID;
  const channelId =
    valueOf(formData, "channelId") || process.env.DISCORD_EVENT_CHANNEL_ID;
  let eventId = "";

  if (!guildId)
    return { ok: false, message: "DISCORD_GUILD_ID is not configured." };
  if (!channelId)
    return {
      ok: false,
      message: "Set DISCORD_EVENT_CHANNEL_ID or enter a channel ID.",
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
      },
    });
    eventId = event.id;
    await artemisApi(`/api/v1/events/${event.id}/publish`, {
      method: "POST",
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

    await artemisApi(`/api/v1/events/${eventId}`, {
      method: "PATCH",
      body: {
        title: optionalValueOf(formData, "title"),
        description: valueOf(formData, "description") || null,
        imageUrl: valueOf(formData, "imageUrl") || null,
        gameSystem: optionalValueOf(formData, "gameSystem"),
        startAt: startAt?.toISOString(),
        endAt: endAt?.toISOString(),
        actorDiscordId: session.discordUserId,
      },
    });
  } catch (error) {
    return { ok: false, message: actionErrorMessage(error) };
  }

  revalidatePath(`/events/${eventId}`);
  return { ok: true, message: "Event updated." };
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

function valueOf(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function optionalValueOf(formData: FormData, key: string) {
  const value = valueOf(formData, key);
  return value || undefined;
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
