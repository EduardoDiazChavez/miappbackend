import { Schema, model } from "mongoose";

const ticketMessageSchema = new Schema(
  {
    ticketId: { type: Schema.Types.ObjectId, ref: "Ticket", required: true, index: true },
    authorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    authorName: { type: String, required: true },
    authorRole: { type: String, enum: ["CLIENT", "TEAM"], required: true },
    content: { type: String, required: true, trim: true, maxlength: 2000 },
    visibility: { type: String, enum: ["CLIENT", "INTERNAL"], default: "CLIENT", required: true },
  },
  { timestamps: true },
);

ticketMessageSchema.index({ ticketId: 1, createdAt: 1 });

export const TicketMessage = model("TicketMessage", ticketMessageSchema);
