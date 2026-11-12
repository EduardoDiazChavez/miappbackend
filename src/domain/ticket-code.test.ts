import assert from "node:assert/strict";
import { test } from "node:test";
import { createTicketCode } from "./ticket-code.js";

test("ticket codes use the customer's saved initials", () => {
  assert.equal(
    createTicketCode("Jane Doe", "ACME", "Acme Consulting", new Date("2026-11-12T00:00:00.000Z")),
    "TKJD-12112026-ACME",
  );
});

test("legacy customers without saved initials keep the name-based ticket code", () => {
  assert.equal(
    createTicketCode("Jane Doe", undefined, "Acme Consulting", new Date("2026-11-12T00:00:00.000Z")),
    "TKJD-12112026-AC",
  );
});
