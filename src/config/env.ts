import { z } from "zod";

const Schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 chars"),
  JWT_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  DB_APP_ROLE: z.string().default("civixlab_app"),
});

export const env = Schema.parse(process.env);
export type AppEnv = z.infer<typeof Schema>;
