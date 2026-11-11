import "dotenv/config";
import { isIP } from "node:net";
import { setServers } from "node:dns";
import { z } from "zod";

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  MONGODB_URI: z.string().min(1),
  DNS_SERVERS: z.string().default("").transform((value) =>
    value.trim() ? value.split(",").map((server) => server.trim()) : [],
  ).refine((servers) => servers.every((server) => isIP(server) !== 0), {
    message: "DNS_SERVERS must contain comma-separated IPv4 or IPv6 addresses.",
  }),
  JWT_SECRET: z.string().min(32),
  GOOGLE_CLIENT_ID: z.string().default(""),
  FRONTEND_ORIGIN: z.string().url(),
  COOKIE_SAME_SITE: z.enum(["lax", "strict", "none"]).default("lax"),
  COOKIE_SECURE: z.string().default("false").transform((value) => value === "true"),
});

const parsedConfig = configSchema.parse(process.env);
if (parsedConfig.NODE_ENV === "production" && !parsedConfig.COOKIE_SECURE) {
  throw new Error("COOKIE_SECURE must be true in production.");
}
if (parsedConfig.COOKIE_SAME_SITE === "none" && !parsedConfig.COOKIE_SECURE) {
  throw new Error("COOKIE_SECURE must be true when COOKIE_SAME_SITE is none.");
}
if (parsedConfig.NODE_ENV === "production" && parsedConfig.DNS_SERVERS.length > 0) {
  throw new Error("Configure DNS_SERVERS at the host or container level in production.");
}
if (parsedConfig.DNS_SERVERS.length > 0) {
  setServers(parsedConfig.DNS_SERVERS);
}

export const config = parsedConfig;
