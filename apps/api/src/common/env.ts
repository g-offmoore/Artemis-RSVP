import { z } from "zod";

const emptyStringToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);
const optionalString = z.preprocess(emptyStringToUndefined, z.string().min(1).optional());
const optionalUrl = z.preprocess(emptyStringToUndefined, z.string().url().optional());

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().trim().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(5),
  DATABASE_PLAN_MAX_CONNECTIONS: z.coerce.number().int().positive().default(25),
  DATABASE_CONNECTION_ALERT_THRESHOLD: z.coerce.number().positive().max(1).default(0.7),
  PGBOSS_POOL_MAX: z.coerce.number().int().positive().default(2),
  PGBOSS_SCHEMA: z.string().trim().min(1).default("pgboss"),
  INTERNAL_API_TOKEN: optionalString,
  METRICS_TOKEN: optionalString,
  DISCORD_OPS_WEBHOOK_URL: optionalUrl,
  FEEDBACK_FORM_URL: optionalUrl
});

export type ApiEnv = z.infer<typeof envSchema>;

export function loadEnv(): ApiEnv {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid API environment: ${parsed.error.message}`);
  }

  return parsed.data;
}
