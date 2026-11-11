import { Schema, model } from "mongoose";
import { roles } from "../domain/roles.js";

const invitationSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    name: { type: String, required: true, trim: true },
    role: { type: String, enum: roles, required: true },
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization" },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
    acceptedAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

export const Invitation = model("Invitation", invitationSchema);
