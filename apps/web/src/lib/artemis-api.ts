const apiBase = process.env.API_INTERNAL_URL ?? "http://api:3000";

export async function artemisApi<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(process.env.INTERNAL_API_TOKEN
        ? { "x-artemis-token": process.env.INTERNAL_API_TOKEN }
        : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Artemis API ${response.status}: ${await response.text()}`);
  }

  return response.json() as Promise<T>;
}

export type EventSummary = {
  id: string;
  title: string;
  status: string;
  gameSystem: string;
  channelId: string;
  messageId?: string;
  startAt: string;
  endAt: string;
  imageUrl?: string;
  _count?: {
    participants: number;
    tables: number;
  };
};

export type GuildSettings = {
  id: string;
  guildId: string;
  defaultTimezone: string;
  defaultEventChannelId?: string;
  staffRoleIds: string[];
  adminRoleIds: string[];
  feedbackFormUrl?: string;
};

export type EventSeriesSummary = {
  id: string;
  name: string;
  recurrenceRule: string;
  defaultGameSystem: string;
  defaultChannelId: string;
  defaultStartHour: number;
  defaultStartMinute: number;
  defaultDurationMinutes: number;
  createdAt: string;
  _count: { events: number };
};

export type EventSeriesDetail = EventSeriesSummary & {
  events: Array<{
    id: string;
    title: string;
    startAt: string;
    status: string;
  }>;
};

export type EventDetail = EventSummary & {
  description?: string;
  seriesId?: string | null;
  assignmentLockedAt?: string;
  participants: Array<{
    id: string;
    displayName: string;
    participantType: string;
    playerCategory: string;
    confirmationStatus: string;
    signupRole?: string;
    backupDmStatus?: string;
  }>;
  tables: Array<{
    id: string;
    title: string;
    tableType: string;
    softCap: number;
    hardCap: number;
    status: string;
    ambassadorProfile?: {
      id: string;
      discordUserId: string;
      displayName: string;
    } | null;
    assignments?: Array<{ status: string }>;
  }>;
  assignments: Array<{
    id: string;
    eventParticipantId: string;
    eventTableId?: string;
    status: string;
    reason: string;
    reasonCode?: string;
    locked: boolean;
  }>;
  auditLogs: Array<{
    id: string;
    action: string;
    actorDiscordId: string;
    createdAt: string;
    reasonCode?: string;
  }>;
  messageJobs?: Array<{
    id: string;
    messageType: string;
    targetId: string;
    scheduledFor: string;
    status: string;
    sentAt?: string;
    failedAt?: string;
    lastError?: string;
  }>;
  roles?: Array<{
    id: string;
    roleType: string;
    name: string;
    discordRoleId?: string | null;
    failedAt?: string | null;
    lastError?: string | null;
    expiresAt: string;
    deletedAt?: string | null;
  }>;
};
