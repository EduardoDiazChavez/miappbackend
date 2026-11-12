import { Schema, model, type InferSchemaType } from "mongoose";

const ticketSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, index: true },
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, required: true, trim: true, maxlength: 5000 },
    status: { type: String, enum: ["OPEN", "IN_PROGRESS", "WAITING", "CLOSED"], default: "OPEN", index: true },
    assignedTo: { type: Schema.Types.ObjectId, ref: "User" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    closedAt: { type: Date },
  },
  { timestamps: true },
);

ticketSchema.index({ organizationId: 1, createdAt: -1 });

export type TicketDocument = InferSchemaType<typeof ticketSchema>;
export const Ticket = model("Ticket", ticketSchema);
