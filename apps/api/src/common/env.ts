import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(5),
  DATABASE_PLAN_MAX_CONNECTIONS: z.coerce.number().int().positive().default(25),
  DATABASE_CONNECTION_ALERT_THRESHOLD: z.coerce.number().positive().max(1).default(0.7),
  INTERNAL_API_TOKEN: z.string().optional(),
  METRICS_TOKEN: z.string().optional(),
  DISCORD_OPS_WEBHOOK_URL: z.string().url().optional(),
  FEEDBACK_FORM_URL: z.string().url().optional()
});

export type ApiEnv = z.infer<typeof envSchema>;

export function loadEnv(): ApiEnv {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid API environment: ${parsed.error.message}`);
  }

  return parsed.data;
}
