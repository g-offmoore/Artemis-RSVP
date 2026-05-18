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

export type EventDetail = EventSummary & {
  description?: string;
  participants: Array<{
    id: string;
    displayName: string;
    participantType: string;
    playerCategory: string;
    confirmationStatus: string;
  }>;
  tables: Array<{
    id: string;
    title: string;
    tableType: string;
    softCap: number;
    hardCap: number;
    status: string;
  }>;
  assignments: Array<{
    id: string;
    eventParticipantId: string;
    eventTableId?: string;
    status: string;
    reason: string;
  }>;
  auditLogs: Array<{
    id: string;
    action: string;
    actorDiscordId: string;
    createdAt: string;
  }>;
};
