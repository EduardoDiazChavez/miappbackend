import mongoose, { type ConnectOptions } from "mongoose";
import { config } from "./config.js";
import { Ticket } from "./models/Ticket.js";
import { GoogleSheetRowCursor } from "./models/GoogleSheetRowCursor.js";
import { GoogleSheetWorkbook } from "./models/GoogleSheetWorkbook.js";
import { TicketSheetSync } from "./models/TicketSheetSync.js";

const invalidTlsOptions = [
  "tlsinsecure",
  "tlsallowinvalidcertificates",
  "tlsallowinvalidhostnames",
  "sslinsecure",
  "sslallowinvalidcertificates",
  "sslallowinvalidhostnames",
];
const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1"]);

function parseMongoConnectionString(connectionString: string) {
  const match = /^(mongodb(?:\+srv)?:)\/\/([^/?#]+)(?:[/?#]|$)/i.exec(connectionString.trim());
  if (!match?.[1] || !match[2]) {
    throw new Error("MONGODB_URI must be a valid MongoDB connection string.");
  }

  const protocol = match[1].toLowerCase();
  const authority = match[2];
  const hosts = authority
    .slice(authority.lastIndexOf("@") + 1)
    .split(",")
    .map((entry) => {
      if (entry.startsWith("[")) {
        const closingBracket = entry.indexOf("]");
        if (closingBracket === -1) {
          throw new Error("MONGODB_URI contains an invalid host.");
        }
        return entry.slice(1, closingBracket).toLowerCase();
      }
      return entry.replace(/:\d+$/, "").toLowerCase();
    });

  if (
    hosts.some((host) => !host) ||
    (protocol === "mongodb+srv:" && (hosts.length !== 1 || authority.includes(",")))
  ) {
    throw new Error("MONGODB_URI contains an invalid MongoDB host list.");
  }

  const queryStart = connectionString.indexOf("?");
  const query = queryStart === -1
    ? ""
    : connectionString.slice(queryStart + 1).split("#", 1)[0];

  return { protocol, hosts, uriOptions: [...new URLSearchParams(query).entries()] };
}

export function createMongoConnectOptions(
  connectionString: string,
  environment: "development" | "test" | "production",
): ConnectOptions {
  const { protocol, hosts, uriOptions } = parseMongoConnectionString(connectionString);
  const normalizedOptions = uriOptions.map(
    ([key, value]): [string, string] => [key.toLowerCase(), value.toLowerCase()],
  );
  const localDevelopment =
    environment !== "production" &&
    protocol === "mongodb:" &&
    hosts.every((host) => loopbackHosts.has(host));
  const tlsRequired = !localDevelopment;
  const tlsDisabled =
    normalizedOptions.some(([key, value]) =>
      (key === "tls" || key === "ssl") && value === "false",
    );

  if (tlsRequired && tlsDisabled) {
    throw new Error("TLS cannot be disabled for remote MongoDB connections.");
  }

  if (
    normalizedOptions.some(([key, value]) =>
      invalidTlsOptions.includes(key) && (value === "true" || value === "1"),
    )
  ) {
    throw new Error("MongoDB certificate and hostname validation cannot be disabled.");
  }

  return {
    appName: "miapp-api",
    autoIndex: environment !== "production",
    connectTimeoutMS: 10_000,
    maxIdleTimeMS: 60_000,
    maxPoolSize: 10,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 10_000,
    tls:
      tlsRequired ||
      normalizedOptions.some(([key, value]) =>
        (key === "tls" || key === "ssl") && value === "true",
      ),
  };
}

export async function connectToDatabase(): Promise<void> {
  const options = createMongoConnectOptions(config.MONGODB_URI, config.NODE_ENV);
  await mongoose.connect(config.MONGODB_URI, options);
  await Ticket.collection.createIndex(
    { organizationId: 1, isOpen: 1 },
    { unique: true, partialFilterExpression: { isOpen: true } },
  );
  await Promise.all([
    GoogleSheetWorkbook.createIndexes(),
    GoogleSheetRowCursor.createIndexes(),
    TicketSheetSync.createIndexes(),
  ]);
  console.info("MongoDB connection established.");
}

export async function disconnectFromDatabase(): Promise<void> {
  await mongoose.disconnect();
}
