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
  /** Where the web app serves /verify/<report number>; encoded in each report's QR code. */
  PUBLIC_VERIFY_BASE_URL: z.string().url().default("http://localhost:3000/verify"),
});

export const env = Schema.parse(process.env);

// The QR code printed on every report points here and cannot be changed later,
// so never fall back to localhost in production.
if (env.NODE_ENV === "production" && !process.env.PUBLIC_VERIFY_BASE_URL) {
  throw new Error("PUBLIC_VERIFY_BASE_URL must be set in production (the QR code on issued reports points to it).");
}
export type AppEnv = z.infer<typeof Schema>;
