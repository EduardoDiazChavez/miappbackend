import type { Role } from "./roles.js";

export const canCreateTickets = (role: Role) => role !== "CLIENT";

export const canCreateOrganizationTickets = (role: Role, allowed: boolean) =>
  canCreateTickets(role) && allowed;

export const canManageUsers = (role: Role) => role === "ADMIN";

export function canAccessOrganization(
  role: Role,
  userOrganizationId: string | undefined,
  requestedOrganizationId: string,
) {
  return role !== "CLIENT" || userOrganizationId === requestedOrganizationId;
}

export function canAccessTicket(
  role: Role,
  userId: string,
  ticketCreatorId: string,
  userOrganizationId: string | undefined,
  ticketOrganizationId: string,
) {
  return role === "CLIENT"
    ? canAccessOrganization(role, userOrganizationId, ticketOrganizationId)
    : userId === ticketCreatorId;
}
