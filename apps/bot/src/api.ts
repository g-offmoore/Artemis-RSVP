import { BotConfig } from "./config.js";

export class ArtemisApiError extends Error {
  constructor(
    readonly status: number,
    readonly responseBody: string,
  ) {
    super(`API ${status}: ${responseBody.slice(0, 500)}`);
    this.name = "ArtemisApiError";
  }
}

export class ArtemisApi {
  constructor(private readonly config: BotConfig) {}

  async getEvents(guildId: string) {
    return this.request(
      `/api/v1/events?guildId=${encodeURIComponent(guildId)}`,
    );
  }

  async getEvent(id: string) {
    return this.request(`/api/v1/events/${id}`);
  }

  async createEvent(payload: Record<string, unknown>) {
    return this.request("/api/v1/events", { method: "POST", body: payload });
  }

  async cancelEvent(id: string, actorDiscordId: string) {
    return this.request(`/api/v1/events/${id}`, {
      method: "DELETE",
      body: { actorDiscordId },
    });
  }

  async rsvp(eventId: string, payload: Record<string, unknown>) {
    return this.request(`/api/v1/events/${eventId}/rsvps`, {
      method: "POST",
      body: payload,
    });
  }

  async cancelRsvp(eventId: string, discordUserId: string) {
    return this.request(`/api/v1/events/${eventId}/rsvps/${encodeURIComponent(discordUserId)}`, {
      method: "DELETE",
    });
  }

  async updateGuests(
    eventId: string,
    discordUserId: string,
    guests: Array<{ displayName: string; discordUserId?: string }>,
  ) {
    return this.request(
      `/api/v1/events/${eventId}/rsvps/${discordUserId}/guests`,
      {
        method: "PATCH",
        body: { guests },
      },
    );
  }

  async createTable(eventId: string, payload: Record<string, unknown>) {
    return this.request(`/api/v1/events/${eventId}/tables`, {
      method: "POST",
      body: payload,
    });
  }

  async runAssignments(eventId: string, actorDiscordId: string) {
    return this.request(`/api/v1/events/${eventId}/assignments/run`, {
      method: "POST",
      body: { actorDiscordId },
    });
  }

  async backupDmAction(
    eventId: string,
    payload: { actorDiscordId: string; participantId: string; action: "pull" | "release" | "decline"; reason?: string },
  ) {
    return this.request(`/api/v1/events/${eventId}/backup-dm/action`, {
      method: "POST",
      body: payload,
    });
  }

  async setPreference(
    eventId: string,
    payload: { userId: string; preferenceType: string; targetUserId?: string; strength?: string },
  ) {
    return this.request(`/api/v1/events/${eventId}/preferences`, {
      method: "POST",
      body: payload,
    });
  }

  async getGuildSettings(guildId: string) {
    return this.request(
      `/api/v1/guild-settings?guildId=${encodeURIComponent(guildId)}`,
    );
  }

  async updateGuildSettings(guildId: string, patch: Record<string, unknown>) {
    return this.request(
      `/api/v1/guild-settings/${encodeURIComponent(guildId)}`,
      { method: "PATCH", body: patch },
    );
  }

  private async request(
    path: string,
    options: { method?: string; body?: unknown } = {},
  ) {
    const response = await fetch(`${this.config.API_URL}${path}`, {
      method: options.method ?? "GET",
      headers: {
        "content-type": "application/json",
        ...(this.config.INTERNAL_API_TOKEN
          ? { "x-artemis-token": this.config.INTERNAL_API_TOKEN }
          : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new ArtemisApiError(response.status, text);
    }

    return response.json();
  }
}
