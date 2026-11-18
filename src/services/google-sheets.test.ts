import assert from "node:assert/strict";
import { test } from "node:test";

process.env.NODE_ENV ??= "test";
process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/miapp-test";
process.env.JWT_SECRET ??= "unit-test-secret-with-at-least-thirty-two-characters";
process.env.GOOGLE_CLIENT_ID ??= "";
process.env.FRONTEND_ORIGIN ??= "http://localhost:3000";

const {
  getGoogleSheetInfo,
  getLastDataRow,
  toGoogleSheetDateSerial,
  toGoogleSheetTimeSerial,
  writeClosedTicketRow,
} = await import("./google-sheets.js");

const ticket = {
  process: "Proceso de prueba",
  description: "Descripción de prueba",
  createdAt: new Date("2026-11-17T13:30:45.000Z"),
  closedAt: new Date("2026-11-17T18:15:00.000Z"),
};

function createResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

test("converts spreadsheet date and time values using its time zone", () => {
  const dateSerial = (Date.UTC(2026, 10, 17) - Date.UTC(1899, 11, 30)) / 86_400_000;
  assert.equal(toGoogleSheetDateSerial(ticket.createdAt, "America/Caracas"), dateSerial);
  assert.equal(
    toGoogleSheetTimeSerial(ticket.createdAt, "America/Caracas"),
    (9 * 3600 + 30 * 60 + 45) / 86_400,
  );
  assert.equal(
    toGoogleSheetTimeSerial(ticket.closedAt, "America/Caracas"),
    (14 * 3600 + 15 * 60) / 86_400,
  );
});

test("writes only ticket data columns and leaves formulas and approval untouched", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return createResponse({});
  };

  await writeClosedTicketRow(
    {
      spreadsheetId: "spreadsheet-id",
      worksheetName: "MRM",
      rowNumber: 14,
      timeZone: "America/Caracas",
      ticket,
    },
    { getAccessToken: async () => "test-token", fetch: fakeFetch },
  );

  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.ok(request);
  assert.equal(request.init?.method, "POST");
  assert.match(request.url, /values:batchUpdate$/);
  const body = JSON.parse(String(request.init?.body)) as {
    valueInputOption: string;
    data: Array<{ range: string; values: unknown[][] }>;
  };
  assert.equal(body.valueInputOption, "RAW");
  assert.deepEqual(body.data.map((entry) => entry.range), [
    "'MRM'!A14",
    "'MRM'!C14:E14",
    "'MRM'!G14:L14",
  ]);
  assert.deepEqual(body.data[1]?.values, [[
    "Hora Remota Asincrónica",
    (9 * 3600 + 30 * 60 + 45) / 86_400,
    (14 * 3600 + 15 * 60) / 86_400,
  ]]);
  assert.deepEqual(body.data[2]?.values, [[
    "General",
    "Proceso de prueba",
    "N/A",
    "N/A",
    "Descripción de prueba",
    "Google Drive",
  ]]);
});

test("reads spreadsheet title, time zone and existing tabs for admin configuration", async () => {
  const info = await getGoogleSheetInfo(
    "spreadsheet-id",
    {
      getAccessToken: async () => "test-token",
      fetch: async () => createResponse({
        properties: { title: "Reporte mensual", timeZone: "America/Caracas" },
        sheets: [{ properties: { sheetId: 7, title: "MRM", gridProperties: { rowCount: 100 } } }],
      }),
    },
  );

  assert.deepEqual(info, {
    spreadsheetId: "spreadsheet-id",
    title: "Reporte mensual",
    timeZone: "America/Caracas",
    sheets: [{ sheetId: 7, title: "MRM", rowCount: 100 }],
  });
});

test("finds the last occupied date row to initialize a sheet row cursor", async () => {
  const lastDataRow = await getLastDataRow(
    "spreadsheet-id",
    "MRM",
    {
      getAccessToken: async () => "test-token",
      fetch: async () => createResponse({ values: [["Fecha"], [46343], [46344]] }),
    },
  );

  assert.equal(lastDataRow, 3);
});
