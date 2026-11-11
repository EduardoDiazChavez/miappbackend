export const roles = ["CLIENT", "OPERATOR", "SUPERVISOR", "ADMIN"] as const;

export type Role = (typeof roles)[number];

export type AuthenticatedUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  organizationId?: string;
};

export const internalRoles: Role[] = ["OPERATOR", "SUPERVISOR", "ADMIN"];
