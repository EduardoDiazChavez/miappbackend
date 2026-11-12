import { Schema, model } from "mongoose";

const organizationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    code: {
      type: String,
      trim: true,
      uppercase: true,
      match: /^[A-Z0-9]{2,8}$/,
      unique: true,
      sparse: true,
    },
    active: { type: Boolean, default: true, required: true },
    allowTicketCreation: { type: Boolean, default: true, required: true },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const Organization = model("Organization", organizationSchema);
