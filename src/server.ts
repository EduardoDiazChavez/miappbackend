import { app } from "./app.js";
import { config } from "./config.js";
import { connectToDatabase, disconnectFromDatabase } from "./database.js";

await connectToDatabase();
const server = app.listen(config.PORT, () => {
  console.info(`MiApp API listening on port ${config.PORT}`);
});

const shutdown = async (signal: string) => {
  console.info(`${signal} received; closing API.`);
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await disconnectFromDatabase();
  process.exit(0);
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
