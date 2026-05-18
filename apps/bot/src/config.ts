import { z } from "zod";

const emptyStringToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);
const optionalString = z.preprocess(emptyStringToUndefined, z.string().min(1).optional());
const optionalUrl = z.preprocess(emptyStringToUndefined, z.string().url().optional());

const configSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_GUILD_ID: z.string().min(1),
  API_URL: z.string().url().default("http://api:3000"),
  INTERNAL_API_TOKEN: optionalString,
  DISCORD_OPS_WEBHOOK_URL: optionalUrl
});

export type BotConfig = z.infer<typeof configSchema>;

export function loadConfig(): BotConfig {
  const apiUrl = emptyStringToUndefined(process.env.API_URL) ?? emptyStringToUndefined(process.env.API_INTERNAL_URL) ?? "http://api:3000";
  const parsed = configSchema.safeParse({
    ...process.env,
    API_URL: normalizeUrl(String(apiUrl))
  });
  if (!parsed.success) {
    throw new Error(`Invalid bot environment: ${parsed.error.message}`);
  }

  return parsed.data;
}

function normalizeUrl(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `http://${value}`;
}
