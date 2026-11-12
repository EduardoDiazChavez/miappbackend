import assert from "node:assert/strict";
import { test } from "node:test";
import { createTicketCode, getNextTicketSequence } from "./ticket-code.js";

test("ticket codes use the customer's saved initials", () => {
  assert.equal(
    createTicketCode("Jane Doe", "ACME", "Acme Consulting", new Date("2026-11-12T00:00:00.000Z"), 1),
    "TKJD-12112026-ACME-001",
  );
});

test("legacy customers without saved initials keep the name-based ticket code", () => {
  assert.equal(
    createTicketCode("Jane Doe", undefined, "Acme Consulting", new Date("2026-11-12T00:00:00.000Z"), 2),
    "TKJD-12112026-AC-002",
  );
});

test("the next sequence increments the latest ticket for the organization", () => {
  assert.equal(getNextTicketSequence("TKJD-12112026-ACME-001"), 2);
  assert.equal(getNextTicketSequence("TKJD-12112026-ACME-099"), 100);
});

test("organizations without a correlated ticket start at 001", () => {
  assert.equal(getNextTicketSequence("TKJD-12112026-ACME"), 1);
  assert.equal(getNextTicketSequence(null), 1);
});
