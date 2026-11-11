import { Schema, model } from "mongoose";

const organizationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    active: { type: Boolean, default: true, required: true },
  },
  { timestamps: true },
);

export const Organization = model("Organization", organizationSchema);
