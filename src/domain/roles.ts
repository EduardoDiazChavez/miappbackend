export const roles = [
  "CLIENT",
  "ADVISOR",
  "ADMIN",
  "SUPER_ADMIN",
] as const;

export type Role = (typeof roles)[number];

export type AuthenticatedUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  organizationId?: string;
};

export const adminRoles: Role[] = ["ADMIN", "SUPER_ADMIN"];
export const internalRoles: Role[] = ["ADVISOR", ...adminRoles];
