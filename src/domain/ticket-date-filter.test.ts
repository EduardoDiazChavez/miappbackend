import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTicketDateRange } from "./ticket-date-filter.js";

test("ticket date range includes the selected local days with an exclusive upper bound", () => {
  const result = parseTicketDateRange(
    "2026-01-02T04:00:00.000Z",
    "2026-01-03T04:00:00.000Z",
  );
  assert.deepEqual(result, {
    createdAt: {
      $gte: new Date("2026-01-02T04:00:00.000Z"),
      $lt: new Date("2026-01-03T04:00:00.000Z"),
    },
  });
});

test("ticket date range rejects invalid and reversed values", () => {
  assert.deepEqual(parseTicketDateRange("not-a-date", undefined), {
    error: "El rango de fechas indicado no es válido.",
  });
  assert.deepEqual(
    parseTicketDateRange("2026-01-03T04:00:00.000Z", "2026-01-03T04:00:00.000Z"),
    { error: "La fecha inicial no puede ser posterior o igual a la fecha final." },
  );
});
