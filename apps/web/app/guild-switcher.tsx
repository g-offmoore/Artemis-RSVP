"use client";

import type { GuildMembership } from "../src/lib/auth";

export function GuildSwitcher({
  guilds,
  activeGuildId,
}: {
  guilds: GuildMembership[];
  activeGuildId: string;
}) {
  if (guilds.length <= 1) {
    return <span>{guilds[0]?.name}</span>;
  }

  return (
    <form action="/api/guild/switch" method="post">
      <select
        name="guildId"
        defaultValue={activeGuildId}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      >
        {guilds.map((guild) => (
          <option key={guild.guildId} value={guild.guildId}>
            {guild.name}
          </option>
        ))}
      </select>
    </form>
  );
}
