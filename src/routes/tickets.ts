import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { requireAuth, requireRoles } from "../middleware/auth.js";
import { Ticket } from "../models/Ticket.js";
import { TicketMessage } from "../models/TicketMessage.js";
import { Organization } from "../models/Organization.js";
import { internalRoles } from "../domain/roles.js";
import {
  canAccessOrganization,
  canCreateOrganizationTickets,
  canCreateTickets,
} from "../domain/permissions.js";
import { createTicketCode, getNextTicketSequence } from "../domain/ticket-code.js";

export const ticketsRouter = Router();
ticketsRouter.use(requireAuth);

const ticketInputSchema = z.object({
  organizationId: z.string().refine(mongoose.Types.ObjectId.isValid),
  process: z.string().trim().min(3).max(160),
  description: z.string().trim().min(5).max(5000),
});
const messageInputSchema = z.object({
  content: z.string().trim().min(1).max(2000),
});
const statusInputSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "WAITING", "CLOSED"]),
});
const openTicketStatuses = ["OPEN", "IN_PROGRESS", "WAITING"] as const;
const openTicketError = "Este cliente ya tiene un ticket abierto. Cierra el ticket actual antes de crear otro.";

function findOpenTicket(organizationId: unknown, excludeTicketId?: unknown) {
  return Ticket.findOne({
    organizationId,
    status: { $in: openTicketStatuses },
    ...(excludeTicketId ? { _id: { $ne: excludeTicketId } } : {}),
  })
    .select("code title status")
    .sort({ createdAt: -1 })
    .lean();
}

function canAccessTicket(
  user: NonNullable<Express.Request["user"]>,
  organizationId: unknown,
) {
  return canAccessOrganization(user.role, user.organizationId, String(organizationId));
}

function isDuplicateKeyError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}

ticketsRouter.get("/", async (request, response) => {
  const user = request.user!;
  const query: Record<string, unknown> = {};

  if (!canCreateTickets(user.role)) {
    if (!user.organizationId) {
      response.json({ tickets: [] });
      return;
    }
    query.organizationId = user.organizationId;
  } else if (typeof request.query.organizationId === "string") {
    if (!mongoose.Types.ObjectId.isValid(request.query.organizationId)) {
      response.status(400).json({ error: "El cliente indicado no es válido." });
      return;
    }
    query.organizationId = request.query.organizationId;
  }

  if (typeof request.query.status === "string") {
    const statusResult = z.enum(["OPEN", "IN_PROGRESS", "WAITING", "CLOSED"]).safeParse(request.query.status);
    if (!statusResult.success) {
      response.status(400).json({ error: "El estado indicado no es válido." });
      return;
    }
    query.status = statusResult.data;
  }

  const page = Math.max(1, Number(request.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(request.query.limit) || 20));
  const [tickets, total] = await Promise.all([
    Ticket.find(query)
      .populate("organizationId", "name")
      .populate("assignedTo", "name")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Ticket.countDocuments(query),
  ]);
  response.json({ tickets, page, limit, total });
});

ticketsRouter.get("/next-sequence", requireRoles(...internalRoles), async (request, response) => {
  const organizationId = request.query.organizationId;
  if (typeof organizationId !== "string" || !mongoose.Types.ObjectId.isValid(organizationId)) {
    response.status(400).json({ error: "El cliente indicado no es válido." });
    return;
  }

  const organization = await Organization.findById(organizationId)
    .select("active allowTicketCreation archivedAt")
    .lean();
  if (!organization || !organization.active || organization.archivedAt) {
    response.status(404).json({ error: "No se encontró el cliente seleccionado." });
    return;
  }
  if (!canCreateOrganizationTickets(request.user!.role, organization.allowTicketCreation !== false)) {
    response.status(403).json({ error: "No está permitido crear tickets para este cliente." });
    return;
  }

  const [latestTicket, openTicket] = await Promise.all([
    Ticket.findOne({ organizationId, code: /-\d+$/ })
      .select("code")
      .sort({ createdAt: -1 })
      .lean(),
    findOpenTicket(organizationId),
  ]);
  response.json({
    nextSequence: getNextTicketSequence(latestTicket?.code),
    openTicket: openTicket
      ? { code: openTicket.code, title: openTicket.title, status: openTicket.status }
      : null,
  });
});

ticketsRouter.get("/organizations", async (request, response) => {
  const query =
    request.user!.role === "CLIENT"
      ? { _id: request.user!.organizationId, active: true, archivedAt: null }
      : { active: true, archivedAt: null, allowTicketCreation: { $ne: false } };
  const organizations = await Organization.find(query).sort({ name: 1 }).lean();
  response.json({
    organizations: organizations.map((organization) => ({
      id: String(organization._id),
      name: organization.name,
      code: organization.code ?? "",
    })),
  });
});

ticketsRouter.get("/summary", requireRoles(...internalRoles), async (_request, response) => {
  const now = new Date();
  const firstMonth = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const [total, active, closed, organizations, groupedByOrganization, monthlyCounts] =
    await Promise.all([
      Ticket.countDocuments(),
      Ticket.countDocuments({ status: { $in: ["OPEN", "IN_PROGRESS", "WAITING"] } }),
      Ticket.countDocuments({ status: "CLOSED" }),
      Organization.countDocuments({ active: true }),
      Ticket.aggregate([
        { $group: { _id: "$organizationId", tickets: { $sum: 1 } } },
        { $sort: { tickets: -1 } },
        { $limit: 8 },
      ]),
      Ticket.aggregate([
        { $match: { createdAt: { $gte: firstMonth } } },
        {
          $group: {
            _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } },
            tickets: { $sum: 1 },
          },
        },
      ]),
    ]);

  const organizationIds = groupedByOrganization.map((item) => item._id);
  const organizationRecords = await Organization.find({ _id: { $in: organizationIds } })
    .select("name")
    .lean();
  const namesById = new Map(organizationRecords.map((item) => [String(item._id), item.name]));
  const clientStats = groupedByOrganization.map((item) => ({
    name: namesById.get(String(item._id)) ?? "Organización",
    tickets: item.tickets as number,
  }));
  const monthlyCountsByKey = new Map(
    monthlyCounts.map((item) => [`${item._id.year}-${item._id.month}`, item.tickets as number]),
  );
  const monthly = Array.from({ length: 6 }, (_value, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - 5 + index, 1);
    const key = `${date.getFullYear()}-${date.getMonth() + 1}`;
    return {
      month: new Intl.DateTimeFormat("es", { month: "short" }).format(date),
      tickets: monthlyCountsByKey.get(key) ?? 0,
    };
  });

  response.json({ total, active, closed, organizations, clientStats, monthly });
});

ticketsRouter.post("/", requireRoles(...internalRoles), async (request, response) => {
  const input = ticketInputSchema.parse(request.body);
  const organization = await Organization.findById(input.organizationId)
    .select("name code active allowTicketCreation archivedAt")
    .lean();
  if (!organization || !organization.active || organization.archivedAt) {
    response.status(404).json({ error: "No se encontró el cliente seleccionado." });
    return;
  }
  if (!canCreateOrganizationTickets(request.user!.role, organization.allowTicketCreation !== false)) {
    response.status(403).json({ error: "No está permitido crear tickets para este cliente." });
    return;
  }
  const existingOpenTicket = await findOpenTicket(input.organizationId);
  if (existingOpenTicket) {
    response.status(409).json({
      error: openTicketError,
      openTicket: {
        code: existingOpenTicket.code,
        title: existingOpenTicket.title,
        status: existingOpenTicket.status,
      },
    });
    return;
  }

  const ticket = await (async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const latestTicket = await Ticket.findOne({
        organizationId: input.organizationId,
        code: /-\d+$/,
      })
        .select("code")
        .sort({ createdAt: -1 })
        .lean();
      const code = createTicketCode(
        request.user!.name,
        organization.code,
        organization.name,
        new Date(),
        getNextTicketSequence(latestTicket?.code),
      );
      try {
        return await Ticket.create({
          organizationId: input.organizationId,
          title: input.process,
          description: input.description,
          code,
          isOpen: true,
          createdBy: request.user!.id,
        });
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
        if (await findOpenTicket(input.organizationId)) return null;
      }
    }
    return null;
  })();
  if (!ticket) {
    const openTicket = await findOpenTicket(input.organizationId);
    response.status(409).json({
      error: openTicket
        ? openTicketError
        : "No se pudo asignar un correlativo único. Intenta crear el ticket nuevamente.",
      ...(openTicket
        ? { openTicket: { code: openTicket.code, title: openTicket.title, status: openTicket.status } }
        : {}),
    });
    return;
  }
  const initialMessage = await TicketMessage.create({
    ticketId: ticket._id,
    authorId: request.user!.id,
    authorName: request.user!.name,
    authorRole: "TEAM",
    content: `Ticket creado: ${ticket.title}`,
    visibility: "CLIENT",
  });
  response.status(201).json({ ticket, message: initialMessage });
});

ticketsRouter.get("/:ticketId", async (request, response) => {
  const ticketId = Array.isArray(request.params.ticketId)
    ? request.params.ticketId[0]
    : request.params.ticketId;
  if (!ticketId) {
    response.status(404).json({ error: "No se encontró el ticket." });
    return;
  }
  const ticket = mongoose.Types.ObjectId.isValid(ticketId)
    ? await Ticket.findById(ticketId).lean()
    : await Ticket.findOne({ code: ticketId }).lean();
  if (!ticket || !canAccessTicket(request.user!, ticket.organizationId)) {
    response.status(404).json({ error: "No se encontró el ticket." });
    return;
  }

  const messageQuery: Record<string, unknown> = { ticketId: ticket._id };
  if (request.user!.role === "CLIENT") {
    messageQuery.visibility = "CLIENT";
  }
  const messages = await TicketMessage.find(messageQuery).sort({ createdAt: 1 }).lean();
  response.json({ ticket, messages });
});

ticketsRouter.post("/:ticketId/messages", async (request, response) => {
  const input = messageInputSchema.parse(request.body);
  const ticketId = Array.isArray(request.params.ticketId)
    ? request.params.ticketId[0]
    : request.params.ticketId;
  if (!ticketId) {
    response.status(404).json({ error: "No se encontró el ticket." });
    return;
  }
  const ticket = mongoose.Types.ObjectId.isValid(ticketId)
    ? await Ticket.findById(ticketId).select("_id organizationId")
    : await Ticket.findOne({ code: ticketId }).select("_id organizationId");
  if (!ticket || !canAccessTicket(request.user!, ticket.organizationId)) {
    response.status(404).json({ error: "No se encontró el ticket." });
    return;
  }

  const message = await TicketMessage.create({
    ticketId: ticket._id,
    authorId: request.user!.id,
    authorName: request.user!.name,
    authorRole: request.user!.role === "CLIENT" ? "CLIENT" : "TEAM",
    content: input.content,
    visibility: "CLIENT",
  });
  response.status(201).json({ message });
});

ticketsRouter.patch(
  "/:ticketId/status",
  requireRoles(...internalRoles),
  async (request, response) => {
    const input = statusInputSchema.parse(request.body);
    const ticketId = Array.isArray(request.params.ticketId)
      ? request.params.ticketId[0]
      : request.params.ticketId;
    if (!ticketId) {
      response.status(404).json({ error: "No se encontró el ticket." });
      return;
    }
    const ticketIdQuery = mongoose.Types.ObjectId.isValid(ticketId)
      ? { _id: ticketId }
      : { code: ticketId };
    const currentTicket = await Ticket.findOne(ticketIdQuery).select("_id organizationId");
    if (!currentTicket) {
      response.status(404).json({ error: "No se encontró el ticket." });
      return;
    }
    if (input.status !== "CLOSED") {
      const openTicket = await findOpenTicket(currentTicket.organizationId, currentTicket._id);
      if (openTicket) {
        response.status(409).json({ error: openTicketError });
        return;
      }
    }

    let ticket;
    try {
      ticket = await Ticket.findOneAndUpdate(
        ticketIdQuery,
        {
          status: input.status,
          isOpen: input.status !== "CLOSED",
          closedAt: input.status === "CLOSED" ? new Date() : null,
        },
        { new: true, runValidators: true },
      );
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      response.status(409).json({ error: openTicketError });
      return;
    }
    if (!ticket) {
      response.status(404).json({ error: "No se encontró el ticket." });
      return;
    }
    await TicketMessage.create({
      ticketId: ticket._id,
      authorId: request.user!.id,
      authorName: request.user!.name,
      authorRole: "TEAM",
      content: `El estado del ticket cambió a ${ticket.status}.`,
      visibility: "CLIENT",
    });
    response.json({ ticket });
  },
);
