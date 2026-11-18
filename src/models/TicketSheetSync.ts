import { Schema, model, type InferSchemaType } from "mongoose";

const ticketSheetSyncSchema = new Schema(
  {
    ticketId: { type: Schema.Types.ObjectId, ref: "Ticket", required: true },
    workbookId: {
      type: Schema.Types.ObjectId,
      ref: "GoogleSheetWorkbook",
      required: true,
    },
    spreadsheetId: { type: String, required: true },
    sheetId: { type: Number, required: true },
    worksheetName: { type: String, required: true },
    rowNumber: { type: Number, required: true },
    status: {
      type: String,
      enum: ["PENDING", "SYNCED", "FAILED"],
      required: true,
      default: "PENDING",
    },
    attempts: { type: Number, required: true, default: 0 },
    lastError: { type: String },
    syncedAt: { type: Date },
  },
  { timestamps: true },
);

ticketSheetSyncSchema.index({ ticketId: 1 }, { unique: true });

export type TicketSheetSyncDocument = InferSchemaType<typeof ticketSheetSyncSchema>;
export const TicketSheetSync = model("TicketSheetSync", ticketSheetSyncSchema);
