import { createHash } from "node:crypto";
import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { requireAuth, requireRoles } from "../middleware/auth.js";
import { config } from "../config.js";
import { createInvitationToken } from "./auth.js";
import { Invitation } from "../models/Invitation.js";
import { Organization } from "../models/Organization.js";
import { User } from "../models/User.js";

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRoles("ADMIN"));

const organizationSchema = z.object({ name: z.string().trim().min(2).max(120) });
const invitationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  organizationId: z.string().refine(mongoose.Types.ObjectId.isValid),
});
const internalUserSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  role: z.enum(["OPERATOR", "SUPERVISOR"]),
});

adminRouter.post("/users/internal", async (request, response) => {
  const input = internalUserSchema.parse(request.body);
  const email = input.email.toLowerCase();
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    response.status(409).json({ error: "Ya existe una cuenta con ese correo." });
    return;
  }

  const user = await User.create({ ...input, email, googleSubject: undefined });
  response.status(201).json({
    user: { id: String(user._id), name: user.name, email: user.email, role: user.role },
  });
});

adminRouter.post("/organizations", async (request, response) => {
  const input = organizationSchema.parse(request.body);
  const existing = await Organization.findOne({ name: input.name });
  if (existing) {
    response.status(409).json({ error: "Ya existe una organización con ese nombre." });
    return;
  }
  const organization = await Organization.create(input);
  response.status(201).json({ organization });
});

adminRouter.get("/organizations", async (_request, response) => {
  const organizations = await Organization.find({ active: true }).sort({ name: 1 }).lean();
  response.json({
    organizations: organizations.map((organization) => ({
      id: String(organization._id),
      name: organization.name,
    })),
  });
});

adminRouter.post("/invitations/clients", async (request, response) => {
  const input = invitationSchema.parse(request.body);
  const organization = await Organization.findOne({
    _id: input.organizationId,
    active: true,
  });
  if (!organization) {
    response.status(404).json({ error: "No se encontró la organización." });
    return;
  }

  const email = input.email.toLowerCase();
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    response.status(409).json({ error: "Ya existe una cuenta con ese correo." });
    return;
  }

  const rawToken = createInvitationToken();
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const invitation = await Invitation.create({
    email,
    name: input.name,
    role: "CLIENT",
    organizationId: organization._id,
    tokenHash,
    expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
    createdBy: request.user!.id,
  });

  response.status(201).json({
    invitation: {
      id: String(invitation._id),
      email,
      organization: organization.name,
      expiresAt: invitation.expiresAt,
      token: rawToken,
      url: `${config.FRONTEND_ORIGIN}/aceptar-invitacion?token=${encodeURIComponent(rawToken)}`,
    },
    message: "Entrega este enlace de invitación por un canal confiable. El token solo se muestra una vez.",
  });
});
