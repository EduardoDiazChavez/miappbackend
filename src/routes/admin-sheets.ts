import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { requireAuth, requireRoles } from "../middleware/auth.js";
import { internalRoles } from "../domain/roles.js";
import { GoogleSheetRowCursor } from "../models/GoogleSheetRowCursor.js";
import { GoogleSheetWorkbook } from "../models/GoogleSheetWorkbook.js";
import { Organization } from "../models/Organization.js";
import { User } from "../models/User.js";
import {
  getGoogleSheetInfo,
  getLastDataRow,
  isGoogleSheetsConfigured,
  normalizeSpreadsheetId,
} from "../services/google-sheets.js";

export const adminSheetsRouter = Router();
adminSheetsRouter.use(requireAuth, requireRoles("ADMIN"));

const sheetMappingSchema = z.object({
  organizationId: z.string().refine(mongoose.Types.ObjectId.isValid),
  sheetId: z.number().int().nonnegative(),
});
const workbookInputSchema = z.object({
  userId: z.string().refine(mongoose.Types.ObjectId.isValid),
  periodLabel: z.string().trim().min(1).max(80),
  spreadsheetId: z.string().trim().min(10).max(500),
  organizationSheets: z.array(sheetMappingSchema).min(1),
});
const mappingsInputSchema = z.object({
  organizationSheets: z.array(sheetMappingSchema).min(1),
});
const spreadsheetIdSchema = z.string().trim().min(10).max(500);

function isDuplicateKeyError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}

function workbookResponse(workbook: {
  _id: unknown;
  userId: unknown;
  periodLabel: string;
  spreadsheetId: string;
  spreadsheetTitle: string;
  timeZone: string;
  organizationSheets: Array<{
    organizationId: unknown;
    sheetId: number;
    worksheetName: string;
  }>;
  isActive: boolean;
  createdAt: Date;
}) {
  return {
    id: String(workbook._id),
    userId: String(workbook.userId),
    periodLabel: workbook.periodLabel,
    spreadsheetId: workbook.spreadsheetId,
    spreadsheetTitle: workbook.spreadsheetTitle,
    timeZone: workbook.timeZone,
    organizationSheets: workbook.organizationSheets.map((mapping) => ({
      organizationId: String(mapping.organizationId),
      sheetId: mapping.sheetId,
      worksheetName: mapping.worksheetName,
    })),
    isActive: workbook.isActive,
    createdAt: workbook.createdAt,
  };
}

async function validateOrganizationSheets(
  spreadsheetId: string,
  mappings: Array<{ organizationId: string; sheetId: number }>,
) {
  const [spreadsheet, organizations] = await Promise.all([
    getGoogleSheetInfo(spreadsheetId),
    Organization.find({
      active: true,
      archivedAt: null,
    }).select("_id name").sort({ name: 1 }).lean(),
  ]);
  const sheetById = new Map(spreadsheet.sheets.map((sheet) => [sheet.sheetId, sheet]));
  const organizationIds = new Set(mappings.map((mapping) => mapping.organizationId));
  const sheetIds = new Set(mappings.map((mapping) => mapping.sheetId));
  if (organizationIds.size !== mappings.length || sheetIds.size !== mappings.length) {
    return { error: "Cada cliente y cada pestaña deben aparecer una sola vez." } as const;
  }
  const expectedOrganizationIds = new Set(organizations.map((organization) => String(organization._id)));
  if (
    expectedOrganizationIds.size !== mappings.length ||
    [...expectedOrganizationIds].some((id) => !organizationIds.has(id))
  ) {
    return { error: "Asigna una pestaña a cada cliente activo antes de guardar." } as const;
  }

  const organizationById = new Map(organizations.map((organization) => [String(organization._id), organization]));
  const organizationSheets = [];
  for (const mapping of mappings) {
    const sheet = sheetById.get(mapping.sheetId);
    const organization = organizationById.get(mapping.organizationId);
    if (!sheet || !organization) {
      return { error: "El cliente o la pestaña seleccionada ya no está disponible." } as const;
    }
    organizationSheets.push({
      organizationId: organization._id,
      sheetId: sheet.sheetId,
      worksheetName: sheet.title,
    });
  }
  return {
    spreadsheet,
    organizations,
    organizationSheets,
  } as const;
}

async function initializeRowCursors(
  spreadsheetId: string,
  mappings: Array<{ sheetId: number; worksheetName: string }>,
) {
  await Promise.all(mappings.map(async (mapping) => {
    const lastDataRow = await getLastDataRow(spreadsheetId, mapping.worksheetName);
    await GoogleSheetRowCursor.updateOne(
      { spreadsheetId, sheetId: mapping.sheetId },
      { $setOnInsert: { lastAllocatedRow: lastDataRow } },
      { upsert: true },
    );
  }));
}

adminSheetsRouter.get("/workbooks", async (_request, response) => {
  const [users, organizations, workbooks] = await Promise.all([
    User.find({ role: { $in: internalRoles }, active: true })
      .select("name email role")
      .sort({ name: 1 })
      .lean(),
    Organization.find({ active: true, archivedAt: null })
      .select("name code")
      .sort({ name: 1 })
      .lean(),
    GoogleSheetWorkbook.find()
      .sort({ createdAt: -1 })
      .lean(),
  ]);
  response.json({
    users: users.map((user) => ({
      id: String(user._id),
      name: user.name,
      email: user.email,
      role: user.role,
    })),
    organizations: organizations.map((organization) => ({
      id: String(organization._id),
      name: organization.name,
      code: organization.code ?? "",
    })),
    workbooks: workbooks.map(workbookResponse),
  });
});

adminSheetsRouter.get("/tabs", async (request, response) => {
  if (!isGoogleSheetsConfigured()) {
    response.status(503).json({ error: "Configura las credenciales de Google Sheets en la API." });
    return;
  }
  const parsedId = spreadsheetIdSchema.safeParse(request.query.spreadsheetId);
  if (!parsedId.success) {
    response.status(400).json({ error: "Indica el enlace o ID de un archivo válido." });
    return;
  }
  try {
    const spreadsheetId = normalizeSpreadsheetId(parsedId.data);
    const spreadsheet = await getGoogleSheetInfo(spreadsheetId);
    response.json(spreadsheet);
  } catch (error) {
    console.error("Could not inspect Google spreadsheet:", error);
    response.status(502).json({ error: "No se pudo consultar el archivo de Google Sheets." });
  }
});

adminSheetsRouter.post("/workbooks", async (request, response) => {
  const input = workbookInputSchema.parse(request.body);
  if (!isGoogleSheetsConfigured()) {
    response.status(503).json({ error: "Configura las credenciales de Google Sheets en la API." });
    return;
  }
  const user = await User.findOne({
    _id: input.userId,
    role: { $in: internalRoles },
    active: true,
  }).select("_id");
  if (!user) {
    response.status(404).json({ error: "El usuario no puede generar tickets o está inactivo." });
    return;
  }

  const spreadsheetId = normalizeSpreadsheetId(input.spreadsheetId);
  const validation = await validateOrganizationSheets(spreadsheetId, input.organizationSheets);
  if ("error" in validation) {
    response.status(400).json({ error: validation.error });
    return;
  }
  await initializeRowCursors(spreadsheetId, validation.organizationSheets);

  let workbook;
  try {
    workbook = await GoogleSheetWorkbook.create({
      userId: user._id,
      periodLabel: input.periodLabel,
      spreadsheetId,
      spreadsheetTitle: validation.spreadsheet.title,
      timeZone: validation.spreadsheet.timeZone,
      organizationSheets: validation.organizationSheets,
      isActive: false,
      activatedBy: request.user!.id,
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      response.status(409).json({ error: "Ya existe un archivo para ese usuario y periodo." });
      return;
    }
    throw error;
  }

  const previous = await GoogleSheetWorkbook.findOne({
    userId: user._id,
    isActive: true,
  }).select("_id");
  if (previous) {
    await GoogleSheetWorkbook.updateOne(
      { _id: previous._id, isActive: true },
      { $set: { isActive: false, closedAt: new Date() } },
    );
  }
  try {
    workbook.isActive = true;
    workbook.closedAt = undefined;
    await workbook.save();
  } catch (error) {
    if (previous) {
      await GoogleSheetWorkbook.updateOne(
        { _id: previous._id },
        { $set: { isActive: true }, $unset: { closedAt: 1 } },
      );
    }
    if (isDuplicateKeyError(error)) {
      response.status(409).json({ error: "Ya existe un archivo para ese usuario y periodo." });
      return;
    }
    throw error;
  }

  response.status(201).json({ workbook: workbookResponse(workbook.toObject()) });
});

adminSheetsRouter.put("/workbooks/:workbookId/mappings", async (request, response) => {
  const { workbookId } = request.params;
  if (!mongoose.Types.ObjectId.isValid(workbookId)) {
    response.status(400).json({ error: "El archivo indicado no es válido." });
    return;
  }
  const input = mappingsInputSchema.parse(request.body);
  if (!isGoogleSheetsConfigured()) {
    response.status(503).json({ error: "Configura las credenciales de Google Sheets en la API." });
    return;
  }
  const workbook = await GoogleSheetWorkbook.findById(workbookId);
  if (!workbook) {
    response.status(404).json({ error: "No se encontró el archivo configurado." });
    return;
  }

  const validation = await validateOrganizationSheets(workbook.spreadsheetId, input.organizationSheets);
  if ("error" in validation) {
    response.status(400).json({ error: validation.error });
    return;
  }
  await initializeRowCursors(workbook.spreadsheetId, validation.organizationSheets);
  const updatedWorkbook = await GoogleSheetWorkbook.findByIdAndUpdate(
    workbook._id,
    { $set: { organizationSheets: validation.organizationSheets } },
    { new: true, runValidators: true },
  );
  if (!updatedWorkbook) {
    response.status(404).json({ error: "No se encontró el archivo configurado." });
    return;
  }
  response.json({ workbook: workbookResponse(updatedWorkbook.toObject()) });
});

adminSheetsRouter.post("/workbooks/:workbookId/activate", async (request, response) => {
  const { workbookId } = request.params;
  if (!mongoose.Types.ObjectId.isValid(workbookId)) {
    response.status(400).json({ error: "El archivo indicado no es válido." });
    return;
  }
  const workbook = await GoogleSheetWorkbook.findById(workbookId);
  if (!workbook) {
    response.status(404).json({ error: "No se encontró el archivo configurado." });
    return;
  }
  if (workbook.isActive) {
    response.json({ workbook: workbookResponse(workbook.toObject()) });
    return;
  }

  const previous = await GoogleSheetWorkbook.findOne({
    userId: workbook.userId,
    isActive: true,
  }).select("_id");
  if (previous) {
    await GoogleSheetWorkbook.updateOne(
      { _id: previous._id, isActive: true },
      { $set: { isActive: false, closedAt: new Date() } },
    );
  }
  try {
    workbook.isActive = true;
    workbook.closedAt = undefined;
    await workbook.save();
  } catch (error) {
    if (previous) {
      await GoogleSheetWorkbook.updateOne(
        { _id: previous._id },
        { $set: { isActive: true }, $unset: { closedAt: 1 } },
      );
    }
    throw error;
  }

  response.json({ workbook: workbookResponse(workbook.toObject()) });
});
