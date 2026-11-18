import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { requireAuth, requireRoles } from "../middleware/auth.js";
import { Ticket } from "../models/Ticket.js";
import { TicketMessage } from "../models/TicketMessage.js";
import { GoogleSheetRowCursor } from "../models/GoogleSheetRowCursor.js";
import { GoogleSheetWorkbook } from "../models/GoogleSheetWorkbook.js";
import { TicketSheetSync } from "../models/TicketSheetSync.js";
import { Organization } from "../models/Organization.js";
import { User } from "../models/User.js";
import { adminRoles, internalRoles } from "../domain/roles.js";
import { parseTicketDateRange } from "../domain/ticket-date-filter.js";
import {
  canAccessTicket,
  canCreateOrganizationTickets,
} from "../domain/permissions.js";
import { createTicketCode, getNextTicketSequence } from "../domain/ticket-code.js";
import {
  getLastDataRow,
  isGoogleSheetsConfigured,
  writeClosedTicketRow,
} from "../services/google-sheets.js";

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
    .select("code process status")
    .sort({ createdAt: -1 })
    .lean();
}

function isDuplicateKeyError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}

class SheetDestinationConfigurationError extends Error {}

async function allocateSheetRow(spreadsheetId: string, sheetId: number, worksheetName: string) {
  const filter = { spreadsheetId, sheetId };
  let cursor = await GoogleSheetRowCursor.findOneAndUpdate(
    filter,
    { $inc: { lastAllocatedRow: 1 } },
    { new: true },
  );
  if (!cursor) {
    const lastDataRow = await getLastDataRow(spreadsheetId, worksheetName);
    try {
      await GoogleSheetRowCursor.updateOne(
        filter,
        { $setOnInsert: { lastAllocatedRow: lastDataRow } },
        { upsert: true },
      );
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
    }
    cursor = await GoogleSheetRowCursor.findOneAndUpdate(
      filter,
      { $inc: { lastAllocatedRow: 1 } },
      { new: true },
    );
  }
  if (!cursor) throw new Error("Could not allocate a Google Sheets row.");
  return cursor.lastAllocatedRow;
}

async function getOrCreateTicketSheetSync(ticket: {
  _id: mongoose.Types.ObjectId;
  createdBy: mongoose.Types.ObjectId;
  organizationId: mongoose.Types.ObjectId;
}) {
  const existingSync = await TicketSheetSync.findOne({ ticketId: ticket._id });
  if (existingSync) return existingSync;

  const workbook = await GoogleSheetWorkbook.findOne({
    userId: ticket.createdBy,
    isActive: true,
  });
  if (!workbook) {
    throw new SheetDestinationConfigurationError(
      "No hay un archivo mensual activo configurado para quien creó este ticket.",
    );
  }
  const mapping = workbook.organizationSheets.find(
    (sheet) => String(sheet.organizationId) === String(ticket.organizationId),
  );
  if (!mapping) {
    throw new SheetDestinationConfigurationError(
      "El archivo activo no tiene una pestaña configurada para la empresa del ticket.",
    );
  }
  const rowNumber = await allocateSheetRow(
    workbook.spreadsheetId,
    mapping.sheetId,
    mapping.worksheetName,
  );
  try {
    return await TicketSheetSync.create({
      ticketId: ticket._id,
      workbookId: workbook._id,
      spreadsheetId: workbook.spreadsheetId,
      sheetId: mapping.sheetId,
      worksheetName: mapping.worksheetName,
      rowNumber,
      status: "PENDING",
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    const concurrentSync = await TicketSheetSync.findOne({ ticketId: ticket._id });
    if (!concurrentSync) throw error;
    return concurrentSync;
  }
}

ticketsRouter.get("/", async (request, response) => {
  const user = request.user!;
  const query: Record<string, unknown> = {};

  if (user.role === "CLIENT") {
    if (!user.organizationId) {
      response.json({ tickets: [] });
      return;
    }
    query.organizationId = user.organizationId;
  } else if (!adminRoles.includes(user.role)) {
    query.createdBy = user.id;
    if (typeof request.query.organizationId === "string") {
      if (!mongoose.Types.ObjectId.isValid(request.query.organizationId)) {
        response.status(400).json({ error: "El cliente indicado no es válido." });
        return;
      }
      query.organizationId = request.query.organizationId;
    }
  }

  if (request.query.userId !== undefined) {
    if (!adminRoles.includes(user.role) && user.role !== "CLIENT") {
      response.status(403).json({ error: "No tienes permiso para filtrar tickets por usuario." });
      return;
    }
    if (typeof request.query.userId !== "string" || !mongoose.Types.ObjectId.isValid(request.query.userId)) {
      response.status(400).json({ error: "El usuario indicado no es válido." });
      return;
    }
    query.createdBy = request.query.userId;
  }

  if (typeof request.query.status === "string") {
    const statusResult = z.enum(["OPEN", "IN_PROGRESS", "WAITING", "CLOSED"]).safeParse(request.query.status);
    if (!statusResult.success) {
      response.status(400).json({ error: "El estado indicado no es válido." });
      return;
    }
    query.status = statusResult.data;
  }

  const dateRange = parseTicketDateRange(request.query.dateFrom, request.query.dateTo);
  if ("error" in dateRange) {
    response.status(400).json({ error: dateRange.error });
    return;
  }
  if ("createdAt" in dateRange) {
    query.createdAt = dateRange.createdAt;
  }

  const page = Math.max(1, Number(request.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(request.query.limit) || 20));
  const [tickets, total] = await Promise.all([
    Ticket.find(query)
      .populate("organizationId", "name")
      .populate("assignedTo", "name")
      .populate("createdBy", "name")
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
      ? { code: openTicket.code, process: openTicket.process, status: openTicket.status }
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

ticketsRouter.get("/summary", requireRoles(...internalRoles), async (request, response) => {
  const ticketScope = { createdBy: new mongoose.Types.ObjectId(request.user!.id) };
  const now = new Date();
  const firstMonth = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const [total, active, closed, organizations, groupedByOrganization, monthlyCounts] =
    await Promise.all([
      Ticket.countDocuments(ticketScope),
      Ticket.countDocuments({ ...ticketScope, status: { $in: ["OPEN", "IN_PROGRESS", "WAITING"] } }),
      Ticket.countDocuments({ ...ticketScope, status: "CLOSED" }),
      Organization.countDocuments({ active: true }),
      Ticket.aggregate([
        { $match: ticketScope },
        { $group: { _id: "$organizationId", tickets: { $sum: 1 } } },
        { $sort: { tickets: -1 } },
        { $limit: 8 },
      ]),
      Ticket.aggregate([
        { $match: { ...ticketScope, createdAt: { $gte: firstMonth } } },
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
        process: existingOpenTicket.process,
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
          process: input.process,
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
        ? { openTicket: { code: openTicket.code, process: openTicket.process, status: openTicket.status } }
        : {}),
    });
    return;
  }
  const initialMessage = await TicketMessage.create({
    ticketId: ticket._id,
    authorId: request.user!.id,
    authorName: request.user!.name,
    authorRole: "TEAM",
    content: `Ticket creado: ${ticket.process}`,
    visibility: "CLIENT",
  });
  response.status(201).json({ ticket, message: initialMessage });
});

ticketsRouter.get("/filter-options", async (request, response) => {
  const user = request.user!;
  const query: Record<string, unknown> = {};
  if (user.role === "CLIENT") {
    if (!user.organizationId) {
      response.json({ users: [] });
      return;
    }
    query.organizationId = user.organizationId;
  } else if (!adminRoles.includes(user.role)) {
    query.createdBy = user.id;
  }

  const creatorIds = await Ticket.distinct("createdBy", query);
  const users = await User.find({ _id: { $in: creatorIds } })
    .select("name")
    .sort({ name: 1 })
    .lean();
  response.json({
    users: users.map((filterUser) => ({ id: String(filterUser._id), name: filterUser.name })),
  });
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
  if (
    !ticket ||
    !canAccessTicket(
      request.user!.role,
      request.user!.id,
      String(ticket.createdBy),
      request.user!.organizationId,
      String(ticket.organizationId),
    )
  ) {
    response.status(404).json({ error: "No se encontró el ticket." });
    return;
  }

  const messageQuery: Record<string, unknown> = { ticketId: ticket._id };
  if (request.user!.role === "CLIENT") {
    messageQuery.visibility = "CLIENT";
  }
  const [messages, sheetSync] = await Promise.all([
    TicketMessage.find(messageQuery).sort({ createdAt: 1 }).lean(),
    internalRoles.includes(request.user!.role)
      ? TicketSheetSync.findOne({ ticketId: ticket._id })
          .select("status attempts lastError syncedAt")
          .lean()
      : null,
  ]);
  response.json({
    ticket,
    messages,
    ...(sheetSync
      ? {
          sheetSync: {
            status: sheetSync.status,
            attempts: sheetSync.attempts,
            lastError: sheetSync.lastError,
            syncedAt: sheetSync.syncedAt,
          },
        }
      : {}),
  });
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
    ? await Ticket.findById(ticketId).select("_id organizationId createdBy")
    : await Ticket.findOne({ code: ticketId }).select("_id organizationId createdBy");
  if (
    !ticket ||
    !canAccessTicket(
      request.user!.role,
      request.user!.id,
      String(ticket.createdBy),
      request.user!.organizationId,
      String(ticket.organizationId),
    )
  ) {
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
    const currentTicket = await Ticket.findOne(ticketIdQuery).select("_id organizationId createdBy");
    if (
      !currentTicket ||
      !canAccessTicket(
        request.user!.role,
        request.user!.id,
        String(currentTicket.createdBy),
        request.user!.organizationId,
        String(currentTicket.organizationId),
      )
    ) {
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

ticketsRouter.post(
  "/:ticketId/sheets-sync",
  requireRoles(...internalRoles),
  async (request, response) => {
    const ticketId = Array.isArray(request.params.ticketId)
      ? request.params.ticketId[0]
      : request.params.ticketId;
    if (!ticketId) {
      response.status(404).json({ error: "No se encontró el ticket." });
      return;
    }
    if (!isGoogleSheetsConfigured()) {
      response.status(503).json({
        error: "Configura Google Sheets en la API antes de sincronizar tickets.",
      });
      return;
    }

    const ticketIdQuery = mongoose.Types.ObjectId.isValid(ticketId)
      ? { _id: ticketId }
      : { code: ticketId };
    const ticket = await Ticket.findOne(ticketIdQuery).select(
      "_id organizationId createdBy code process description status createdAt closedAt",
    );
    if (
      !ticket ||
      !canAccessTicket(
        request.user!.role,
        request.user!.id,
        String(ticket.createdBy),
        request.user!.organizationId,
        String(ticket.organizationId),
      )
    ) {
      response.status(404).json({ error: "No se encontró el ticket." });
      return;
    }
    if (ticket.status !== "CLOSED") {
      response.status(409).json({ error: "Solo se pueden sincronizar tickets cerrados." });
      return;
    }
    if (!ticket.closedAt) {
      response.status(409).json({ error: "El ticket no tiene una hora de cierre registrada." });
      return;
    }
    let syncRecord: Awaited<ReturnType<typeof getOrCreateTicketSheetSync>> | null = null;
    let syncResult: {
      spreadsheetTitle: string;
      worksheetName: string;
      rowNumber: number;
    } | null = null;
    try {
      syncRecord = await getOrCreateTicketSheetSync({
        _id: ticket._id,
        createdBy: ticket.createdBy,
        organizationId: ticket.organizationId,
      });
      const workbook = await GoogleSheetWorkbook.findById(syncRecord.workbookId);
      if (!workbook) throw new Error("No se encontró el archivo asignado a este ticket.");

      await TicketSheetSync.updateOne(
        { _id: syncRecord._id },
        {
          $set: { status: "PENDING" },
          $unset: { lastError: 1 },
          $inc: { attempts: 1 },
        },
      );
      await writeClosedTicketRow({
        spreadsheetId: syncRecord.spreadsheetId,
        worksheetName: syncRecord.worksheetName,
        rowNumber: syncRecord.rowNumber,
        timeZone: workbook.timeZone,
        ticket: {
          process: ticket.process,
          description: ticket.description,
          createdAt: ticket.createdAt,
          closedAt: ticket.closedAt,
        },
      });
      await TicketSheetSync.updateOne(
        { _id: syncRecord._id },
        { $set: { status: "SYNCED", syncedAt: new Date() }, $unset: { lastError: 1 } },
      );
      syncResult = {
        spreadsheetTitle: workbook.spreadsheetTitle,
        worksheetName: syncRecord.worksheetName,
        rowNumber: syncRecord.rowNumber,
      };
    } catch (error) {
      if (syncRecord) {
        await TicketSheetSync.updateOne(
          { _id: syncRecord._id },
          {
            $set: {
              status: "FAILED",
              lastError: error instanceof Error ? error.message.slice(0, 1000) : "Unknown sync error",
            },
          },
        );
      }
      if (error instanceof SheetDestinationConfigurationError) {
        response.status(409).json({ error: error.message });
        return;
      }
      console.error("Google Sheets ticket sync failed:", error);
      response.status(502).json({
        error: error instanceof Error ? error.message : "No se pudo actualizar Google Sheets para este ticket.",
      });
      return;
    }

    response.json({
      message: "Ticket sincronizado con Google Sheets.",
      sync: { status: "SYNCED", ...syncResult },
    });
  },
);
