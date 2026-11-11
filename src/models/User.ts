import { Schema, model, type InferSchemaType } from "mongoose";
import { roles } from "../domain/roles.js";

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    role: { type: String, enum: roles, required: true },
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", index: true },
    passwordHash: { type: String, select: false },
    googleSubject: { type: String, unique: true, sparse: true, select: false },
    active: { type: Boolean, default: true, required: true },
  },
  { timestamps: true },
);

export type UserDocument = InferSchemaType<typeof userSchema>;
export const User = model("User", userSchema);
