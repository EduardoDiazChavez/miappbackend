import { Schema, model, type InferSchemaType } from "mongoose";

const googleSheetRowCursorSchema = new Schema(
  {
    spreadsheetId: { type: String, required: true },
    sheetId: { type: Number, required: true },
    lastAllocatedRow: { type: Number, required: true },
  },
  { timestamps: true },
);

googleSheetRowCursorSchema.index(
  { spreadsheetId: 1, sheetId: 1 },
  { unique: true },
);

export type GoogleSheetRowCursorDocument = InferSchemaType<typeof googleSheetRowCursorSchema>;
export const GoogleSheetRowCursor = model("GoogleSheetRowCursor", googleSheetRowCursorSchema);
