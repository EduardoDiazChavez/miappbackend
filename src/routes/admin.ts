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

const organizationCodeSchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,8}$/);
const organizationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: organizationCodeSchema,
});
const organizationUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  code: organizationCodeSchema.optional(),
  active: z.boolean().optional(),
  allowTicketCreation: z.boolean().optional(),
  archived: z.boolean().optional(),
}).refine(
  (input) => Object.keys(input).length > 0 &&
    (input.archived === undefined || Object.keys(input).length === 1),
  { message: "La operación de archivo debe enviarse por separado." },
);
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
  const existing = await Organization.findOne({
    $or: [{ name: input.name }, { code: input.code }],
  });
  if (existing) {
    response.status(409).json({ error: "Ya existe un cliente con ese nombre o esas siglas." });
    return;
  }
  const organization = await Organization.create(input);
  response.status(201).json({ organization });
});

adminRouter.get("/organizations", async (_request, response) => {
  const organizations = await Organization.find().sort({ name: 1 }).lean();
  response.json({
    organizations: organizations.map((organization) => ({
      id: String(organization._id),
      name: organization.name,
      code: organization.code ?? "",
      active: organization.active,
      allowTicketCreation: organization.allowTicketCreation !== false,
      archived: Boolean(organization.archivedAt),
    })),
  });
});

adminRouter.patch("/organizations/:organizationId", async (request, response) => {
  const organizationId = request.params.organizationId;
  if (!mongoose.Types.ObjectId.isValid(organizationId)) {
    response.status(400).json({ error: "El cliente indicado no es válido." });
    return;
  }

  const input = organizationUpdateSchema.parse(request.body);
  const duplicateValues = [
    ...(input.name ? [{ name: input.name }] : []),
    ...(input.code ? [{ code: input.code }] : []),
  ];
  if (duplicateValues.length > 0) {
    const duplicate = await Organization.findOne({
      _id: { $ne: organizationId },
      $or: duplicateValues,
    });
    if (duplicate) {
      response.status(409).json({ error: "Ya existe un cliente con ese nombre o esas siglas." });
      return;
    }
  }

  const { archived, ...fields } = input;
  const update = archived === true
    ? { active: false, allowTicketCreation: false, archivedAt: new Date() }
    : archived === false
      ? { archivedAt: null }
      : fields;
  const organization = await Organization.findByIdAndUpdate(
    organizationId,
    { $set: update },
    { new: true, runValidators: true },
  ).lean();

  if (!organization) {
    response.status(404).json({ error: "No se encontró el cliente." });
    return;
  }
  response.json({
    organization: {
      id: String(organization._id),
      name: organization.name,
      code: organization.code ?? "",
      active: organization.active,
      allowTicketCreation: organization.allowTicketCreation !== false,
      archived: Boolean(organization.archivedAt),
    },
  });
});

adminRouter.post("/invitations/clients", async (request, response) => {
  const input = invitationSchema.parse(request.body);
  const organization = await Organization.findOne({
    _id: input.organizationId,
    active: true,
    archivedAt: null,
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
