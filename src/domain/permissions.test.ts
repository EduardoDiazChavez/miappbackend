import assert from "node:assert/strict";
import { test } from "node:test";
import { canAccessOrganization, canCreateTickets, canManageUsers } from "./permissions.js";

test("clients can only access tickets from their own organization", () => {
  assert.equal(canAccessOrganization("CLIENT", "org-1", "org-1"), true);
  assert.equal(canAccessOrganization("CLIENT", "org-1", "org-2"), false);
  assert.equal(canAccessOrganization("CLIENT", undefined, "org-1"), false);
});

test("internal roles can access cross-organization tickets", () => {
  assert.equal(canAccessOrganization("OPERATOR", undefined, "org-1"), true);
  assert.equal(canAccessOrganization("SUPERVISOR", undefined, "org-2"), true);
});

test("only internal roles can create tickets and only admins can manage users", () => {
  assert.equal(canCreateTickets("CLIENT"), false);
  assert.equal(canCreateTickets("OPERATOR"), true);
  assert.equal(canCreateTickets("SUPERVISOR"), true);
  assert.equal(canManageUsers("ADMIN"), true);
  assert.equal(canManageUsers("OPERATOR"), false);
});
