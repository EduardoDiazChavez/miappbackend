import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canAccessTicket,
  canAccessOrganization,
  canCreateOrganizationTickets,
  canCreateTickets,
  canManageUsers,
} from "./permissions.js";

test("clients can only access tickets from their own organization", () => {
  assert.equal(canAccessOrganization("CLIENT", "org-1", "org-1"), true);
  assert.equal(canAccessOrganization("CLIENT", "org-1", "org-2"), false);
  assert.equal(canAccessOrganization("CLIENT", undefined, "org-1"), false);
});

test("internal roles can access organizations across scope", () => {
  assert.equal(canAccessOrganization("ADVISOR", undefined, "org-1"), true);
  assert.equal(canAccessOrganization("ADMIN", undefined, "org-2"), true);
});

test("ticket creators can access their tickets across organizations, but not other users' tickets", () => {
  assert.equal(canAccessTicket("ADVISOR", "user-1", "user-1", undefined, "org-1"), true);
  assert.equal(canAccessTicket("ADVISOR", "user-1", "user-2", undefined, "org-1"), false);
});

test("clients can access every ticket from their organization, regardless of its creator", () => {
  assert.equal(canAccessTicket("CLIENT", "client-1", "user-1", "org-1", "org-1"), true);
  assert.equal(canAccessTicket("CLIENT", "client-1", "user-2", "org-1", "org-1"), true);
  assert.equal(canAccessTicket("CLIENT", "client-1", "user-1", "org-1", "org-2"), false);
});

test("administrators can access tickets created by any user", () => {
  assert.equal(canAccessTicket("ADMIN", "admin-1", "user-1", undefined, "org-1"), true);
  assert.equal(canAccessTicket("SUPER_ADMIN", "root-1", "user-1", undefined, "org-1"), true);
});

test("only internal roles can create tickets and only admins can manage users", () => {
  assert.equal(canCreateTickets("CLIENT"), false);
  assert.equal(canCreateTickets("ADVISOR"), true);
  assert.equal(canManageUsers("ADMIN"), true);
  assert.equal(canManageUsers("SUPER_ADMIN"), true);
  assert.equal(canManageUsers("ADVISOR"), false);
});

test("ticket creation can be disabled for one organization", () => {
  assert.equal(canCreateOrganizationTickets("ADVISOR", false), false);
  assert.equal(canCreateOrganizationTickets("ADVISOR", true), true);
  assert.equal(canCreateOrganizationTickets("CLIENT", true), false);
});
