import { z } from "zod";

const configSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_GUILD_ID: z.string().min(1),
  API_URL: z.string().url().default("http://api:3000"),
  INTERNAL_API_TOKEN: z.string().optional(),
  DISCORD_OPS_WEBHOOK_URL: z.string().url().optional()
});

export type BotConfig = z.infer<typeof configSchema>;

export function loadConfig(): BotConfig {
  const parsed = configSchema.safeParse({
    ...process.env,
    API_URL: normalizeUrl(process.env.API_URL ?? process.env.API_INTERNAL_URL ?? "http://api:3000")
  });
  if (!parsed.success) {
    throw new Error(`Invalid bot environment: ${parsed.error.message}`);
  }

  return parsed.data;
}

function normalizeUrl(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `http://${value}`;
}
