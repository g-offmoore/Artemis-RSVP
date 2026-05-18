import { BotConfig } from "./config.js";

export class ArtemisApi {
  constructor(private readonly config: BotConfig) {}

  async getEvents(guildId: string) {
    return this.request(`/api/v1/events?guildId=${encodeURIComponent(guildId)}`);
  }

  async getEvent(id: string) {
    return this.request(`/api/v1/events/${id}`);
  }

  async createEvent(payload: Record<string, unknown>) {
    return this.request("/api/v1/events", { method: "POST", body: payload });
  }

  async cancelEvent(id: string, actorDiscordId: string) {
    return this.request(`/api/v1/events/${id}`, { method: "DELETE", body: { actorDiscordId } });
  }

  async rsvp(eventId: string, payload: Record<string, unknown>) {
    return this.request(`/api/v1/events/${eventId}/rsvps`, { method: "POST", body: payload });
  }

  async updateGuests(eventId: string, discordUserId: string, guests: Array<{ displayName: string; discordUserId?: string }>) {
    return this.request(`/api/v1/events/${eventId}/rsvps/${discordUserId}/guests`, {
      method: "PATCH",
      body: { guests }
    });
  }

  async createTable(eventId: string, payload: Record<string, unknown>) {
    return this.request(`/api/v1/events/${eventId}/tables`, { method: "POST", body: payload });
  }

  async runAssignments(eventId: string, actorDiscordId: string) {
    return this.request(`/api/v1/events/${eventId}/assignments/run`, {
      method: "POST",
      body: { actorDiscordId }
    });
  }

  private async request(path: string, options: { method?: string; body?: unknown } = {}) {
    const response = await fetch(`${this.config.API_URL}${path}`, {
      method: options.method ?? "GET",
      headers: {
        "content-type": "application/json",
        ...(this.config.INTERNAL_API_TOKEN ? { "x-artemis-token": this.config.INTERNAL_API_TOKEN } : {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`API ${response.status}: ${text.slice(0, 500)}`);
    }

    return response.json();
  }
}
