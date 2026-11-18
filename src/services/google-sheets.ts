import { GoogleAuth } from "google-auth-library";
import { z } from "zod";
import { config } from "../config.js";

const sheetsScope = "https://www.googleapis.com/auth/spreadsheets";
const googleEpoch = Date.UTC(1899, 11, 30);

const spreadsheetInfoSchema = z.object({
  properties: z.object({
    title: z.string().optional(),
    timeZone: z.string().optional(),
  }).optional(),
  sheets: z.array(z.object({
    properties: z.object({
      sheetId: z.number().int(),
      title: z.string(),
      gridProperties: z.object({ rowCount: z.number().int().optional() }).optional(),
    }),
  })).default([]),
});
const columnValuesSchema = z.object({
  values: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))).optional(),
});

export type GoogleSheetInfo = {
  spreadsheetId: string;
  title: string;
  timeZone: string;
  sheets: Array<{ sheetId: number; title: string; rowCount: number }>;
};

export type ClosedTicketSheetRecord = {
  process: string;
  description: string;
  createdAt: Date;
  closedAt: Date;
};

type GoogleSheetsDependencies = {
  getAccessToken: () => Promise<string | null>;
  fetch: typeof fetch;
};

function getDefaultDependencies(): GoogleSheetsDependencies {
  return {
    getAccessToken: async () => {
      const auth = new GoogleAuth({
        keyFile: config.GOOGLE_APPLICATION_CREDENTIALS,
        scopes: [sheetsScope],
      });
      return (await auth.getAccessToken()) ?? null;
    },
    fetch,
  };
}

function quoteWorksheet(worksheet: string) {
  return `'${worksheet.replace(/'/g, "''")}'`;
}

async function getAccessToken(dependencies: GoogleSheetsDependencies) {
  const token = await dependencies.getAccessToken();
  if (!token) throw new Error("Google authentication did not return an access token.");
  return token;
}

async function fetchGoogleApi(
  url: string,
  token: string,
  dependencies: GoogleSheetsDependencies,
  init: RequestInit = {},
) {
  const response = await dependencies.fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(
      `Google Sheets API request failed (${response.status})${details ? `: ${details}` : ""}`,
    );
  }
  return response;
}

export function isGoogleSheetsConfigured() {
  return Boolean(config.GOOGLE_APPLICATION_CREDENTIALS);
}

export function normalizeSpreadsheetId(value: string) {
  const trimmed = value.trim();
  const match = /\/spreadsheets\/d\/([A-Za-z0-9_-]+)/.exec(trimmed);
  return match?.[1] ?? trimmed;
}

export async function getGoogleSheetInfo(
  spreadsheetId: string,
  overrides?: Partial<GoogleSheetsDependencies>,
): Promise<GoogleSheetInfo> {
  const dependencies = { ...getDefaultDependencies(), ...overrides };
  const token = await getAccessToken(dependencies);
  const params = new URLSearchParams({
    fields: "properties(title,timeZone),sheets(properties(sheetId,title,gridProperties(rowCount)))",
  });
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?${params}`;
  const response = await fetchGoogleApi(url, token, dependencies);
  const result = spreadsheetInfoSchema.safeParse(await response.json());
  if (!result.success) throw new Error("Google Sheets returned invalid spreadsheet metadata.");

  return {
    spreadsheetId,
    title: result.data.properties?.title ?? "",
    timeZone: result.data.properties?.timeZone ?? "Etc/UTC",
    sheets: result.data.sheets.map(({ properties }) => ({
      sheetId: properties.sheetId,
      title: properties.title,
      rowCount: properties.gridProperties?.rowCount ?? 0,
    })),
  };
}

export async function getLastDataRow(
  spreadsheetId: string,
  worksheetName: string,
  overrides?: Partial<GoogleSheetsDependencies>,
) {
  const dependencies = { ...getDefaultDependencies(), ...overrides };
  const token = await getAccessToken(dependencies);
  const range = encodeURIComponent(`${quoteWorksheet(worksheetName)}!A:A`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}?valueRenderOption=UNFORMATTED_VALUE`;
  const response = await fetchGoogleApi(url, token, dependencies);
  const result = columnValuesSchema.safeParse(await response.json());
  if (!result.success) throw new Error("Google Sheets returned invalid column data.");

  const values = result.data.values ?? [];
  let lastDataRow = 1;
  values.forEach((row, index) => {
    if (row[0] !== undefined && row[0] !== null && String(row[0]).trim() !== "") {
      lastDataRow = index + 1;
    }
  });
  return lastDataRow;
}

function getZonedDateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, Number(part.value)]));
  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");
  const hour = values.get("hour");
  const minute = values.get("minute");
  const second = values.get("second");
  if (
    year === undefined || month === undefined || day === undefined ||
    hour === undefined || minute === undefined || second === undefined
  ) {
    throw new Error("Could not convert ticket timestamp to the spreadsheet time zone.");
  }
  return { year, month, day, hour, minute, second };
}

export function toGoogleSheetDateSerial(date: Date, timeZone: string) {
  const { year, month, day } = getZonedDateParts(date, timeZone);
  return (Date.UTC(year, month - 1, day) - googleEpoch) / 86_400_000;
}

export function toGoogleSheetTimeSerial(date: Date, timeZone: string) {
  const { hour, minute, second } = getZonedDateParts(date, timeZone);
  const milliseconds = date.getUTCMilliseconds();
  return (hour * 3600 + minute * 60 + second + milliseconds / 1000) / 86_400;
}

export async function writeClosedTicketRow(
  options: {
    spreadsheetId: string;
    worksheetName: string;
    rowNumber: number;
    timeZone: string;
    ticket: ClosedTicketSheetRecord;
  },
  overrides?: Partial<GoogleSheetsDependencies>,
) {
  const dependencies = { ...getDefaultDependencies(), ...overrides };
  if (!Number.isInteger(options.rowNumber) || options.rowNumber < 2) {
    throw new Error("Google Sheets row number must be 2 or greater.");
  }

  const token = await getAccessToken(dependencies);
  const quotedName = quoteWorksheet(options.worksheetName);
  const rangeData = [
    {
      range: `${quotedName}!A${options.rowNumber}`,
      values: [[toGoogleSheetDateSerial(options.ticket.createdAt, options.timeZone)]],
    },
    {
      range: `${quotedName}!C${options.rowNumber}:E${options.rowNumber}`,
      values: [[
        "Hora Remota Asincrónica",
        toGoogleSheetTimeSerial(options.ticket.createdAt, options.timeZone),
        toGoogleSheetTimeSerial(options.ticket.closedAt, options.timeZone),
      ]],
    },
    {
      range: `${quotedName}!G${options.rowNumber}:L${options.rowNumber}`,
      values: [[
        "General",
        options.ticket.process,
        "N/A",
        "N/A",
        options.ticket.description,
        "Google Drive",
      ]],
    },
  ];
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(options.spreadsheetId)}/values:batchUpdate`;
  await fetchGoogleApi(url, token, dependencies, {
    method: "POST",
    body: JSON.stringify({ valueInputOption: "RAW", data: rangeData }),
  });
}
