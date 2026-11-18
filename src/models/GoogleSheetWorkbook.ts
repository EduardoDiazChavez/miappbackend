import { Schema, model, type InferSchemaType } from "mongoose";

const organizationSheetSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    sheetId: { type: Number, required: true },
    worksheetName: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const googleSheetWorkbookSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    periodLabel: { type: String, required: true, trim: true, maxlength: 80 },
    spreadsheetId: { type: String, required: true, trim: true },
    spreadsheetTitle: { type: String, required: true, trim: true },
    timeZone: { type: String, required: true, trim: true },
    organizationSheets: { type: [organizationSheetSchema], required: true },
    isActive: { type: Boolean, required: true, default: false },
    activatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    closedAt: { type: Date },
  },
  { timestamps: true },
);

googleSheetWorkbookSchema.index(
  { userId: 1, periodLabel: 1 },
  { unique: true },
);
googleSheetWorkbookSchema.index(
  { userId: 1, isActive: 1 },
  { unique: true, partialFilterExpression: { isActive: true } },
);

export type GoogleSheetWorkbookDocument = InferSchemaType<typeof googleSheetWorkbookSchema>;
export const GoogleSheetWorkbook = model("GoogleSheetWorkbook", googleSheetWorkbookSchema);
