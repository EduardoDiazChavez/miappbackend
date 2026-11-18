import mongoose from "mongoose";
import { connectToDatabase, disconnectFromDatabase } from "../database.js";

async function migrateTicketTitleToProcess() {
  await connectToDatabase();
  try {
    const tickets = mongoose.connection.collection("tickets");
    const conflictingRecords = await tickets.countDocuments({
      title: { $exists: true },
      process: { $exists: true },
    });
    if (conflictingRecords > 0) {
      throw new Error(
        `Migration stopped: ${conflictingRecords} tickets already contain both title and process.`,
      );
    }

    const result = await tickets.updateMany(
      { title: { $exists: true }, process: { $exists: false } },
      { $rename: { title: "process" } },
    );
    console.info(`Migrated ${result.modifiedCount} ticket records from title to process.`);
  } finally {
    await disconnectFromDatabase();
  }
}

await migrateTicketTitleToProcess();
