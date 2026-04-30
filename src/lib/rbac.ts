// Mirrors `civixlab/src/lib/rbac.ts` — kept in sync so a JWT minted here
// carries the exact `permissions[]` the frontend expects on the wire.

export type Role =
  | "Super Admin"
  | "Tenant Admin"
  | "Quality Manager"
  | "Project Manager"
  | "Lab Engineer"
  | "Lab Technician"
  | "Field Technician"
  | "Reviewer"
  | "Approver"
  | "Client"
  | "Billing Admin";

export type Permission =
  | "test:create" | "test:read" | "test:update" | "test:delete"
  | "test:submit" | "test:review" | "test:approve" | "test:sign"
  | "sample:create" | "sample:read" | "sample:update"
  | "project:create" | "project:read" | "project:update"
  | "equipment:read" | "equipment:create" | "equipment:calibrate"
  | "user:invite" | "user:manage"
  | "report:read" | "report:export"
  | "audit:read" | "audit:export"
  | "billing:read" | "billing:create"
  | "settings:write" | "whitelabel:write" | "security:write";

const PERMS: Record<Role, Permission[]> = {
  "Super Admin": [
    "test:create","test:read","test:update","test:delete","test:submit","test:review","test:approve","test:sign",
    "sample:create","sample:read","sample:update",
    "project:create","project:read","project:update",
    "equipment:read","equipment:create","equipment:calibrate",
    "user:invite","user:manage",
    "report:read","report:export",
    "audit:read","audit:export",
    "billing:read","billing:create",
    "settings:write","whitelabel:write","security:write",
  ],
  "Tenant Admin": [
    "test:read","sample:read","project:create","project:read","project:update",
    "equipment:read","equipment:create","equipment:calibrate",
    "user:invite","user:manage",
    "report:read","report:export",
    "audit:read","audit:export",
    "billing:read","billing:create",
    "settings:write","whitelabel:write","security:write",
  ],
  "Quality Manager": [
    "test:read","test:review","test:approve",
    "sample:read","project:read",
    "equipment:read",
    "report:read","report:export",
    "audit:read","audit:export",
  ],
  "Project Manager": [
    "test:create","test:read","test:update","test:submit",
    "sample:create","sample:read","sample:update",
    "project:create","project:read","project:update",
    "equipment:read","report:read","report:export",
  ],
  "Lab Engineer": [
    "test:create","test:read","test:update","test:submit",
    "sample:create","sample:read","sample:update",
    "project:read","equipment:read","equipment:calibrate",
    "report:read","report:export",
  ],
  "Lab Technician": [
    "test:create","test:read","test:update","test:submit",
    "sample:create","sample:read",
    "project:read","equipment:read","report:read",
  ],
  "Field Technician": [
    "sample:create","sample:read","project:read","equipment:read",
  ],
  "Reviewer": [
    "test:read","test:review","sample:read","project:read","report:read",
  ],
  "Approver": [
    "test:read","test:approve","test:sign","sample:read","project:read","report:read","report:export",
  ],
  "Client": [
    "report:read",
  ],
  "Billing Admin": [
    "billing:read","billing:create","report:read",
  ],
};

export function rolePermissions(role: string | null | undefined): Permission[] {
  if (!role) return [];
  return PERMS[role as Role] ?? [];
}

export function hasPermission(role: string | null | undefined, perm: Permission): boolean {
  return rolePermissions(role).includes(perm);
}
