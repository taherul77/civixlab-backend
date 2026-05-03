// Mirrors `civixlab/src/lib/rbac.ts` — kept in sync so a JWT minted here
// carries the exact `permissions[]` the frontend expects on the wire.

// Roles are tenant-defined. Only "Super Admin" and "Tenant Admin" are fixed:
// Super Admin is platform-level (users.is_super_admin); Tenant Admin is
// auto-created per tenant and undeletable. Everything else is seed data.
export type Role = string;
export const SUPER_ADMIN_ROLE = "Super Admin";
export const TENANT_ADMIN_ROLE = "Tenant Admin";

export const BUILT_IN_ROLE_TEMPLATES = [
  "Super Admin","Tenant Admin","Quality Manager","Project Manager",
  "Lab Engineer","Lab Technician","Field Technician","Reviewer",
  "Approver","Client","Billing Admin",
] as const;

// Standard CRUD on every resource (`<resource>:read|create|update|delete`)
// plus contextual actions where the workflow needs them.
export type Permission =
  | "test:create" | "test:read" | "test:update" | "test:delete"
  | "test:submit" | "test:review" | "test:approve" | "test:sign"
  | "sample:create" | "sample:read" | "sample:update" | "sample:delete"
  | "project:create" | "project:read" | "project:update" | "project:delete"
  | "equipment:create" | "equipment:read" | "equipment:update" | "equipment:delete" | "equipment:calibrate"
  | "user:create" | "user:read" | "user:update" | "user:delete" | "user:invite"
  | "report:create" | "report:read" | "report:update" | "report:delete" | "report:export"
  | "audit:read" | "audit:export"
  | "billing:create" | "billing:read" | "billing:update" | "billing:delete"
  | "settings:read" | "settings:update"
  | "whitelabel:read" | "whitelabel:update"
  | "security:read" | "security:update";

const ALL_PERMS_LIST: Permission[] = [
  "test:create","test:read","test:update","test:delete",
  "test:submit","test:review","test:approve","test:sign",
  "sample:create","sample:read","sample:update","sample:delete",
  "project:create","project:read","project:update","project:delete",
  "equipment:create","equipment:read","equipment:update","equipment:delete","equipment:calibrate",
  "user:create","user:read","user:update","user:delete","user:invite",
  "report:create","report:read","report:update","report:delete","report:export",
  "audit:read","audit:export",
  "billing:create","billing:read","billing:update","billing:delete",
  "settings:read","settings:update",
  "whitelabel:read","whitelabel:update",
  "security:read","security:update",
];

const PERMS: Record<string, Permission[]> = {
  "Super Admin": ALL_PERMS_LIST,
  "Tenant Admin": [
    "test:read","test:update","test:delete",
    "sample:read","sample:delete",
    "project:create","project:read","project:update","project:delete",
    "equipment:create","equipment:read","equipment:update","equipment:delete","equipment:calibrate",
    "user:create","user:read","user:update","user:delete","user:invite",
    "report:read","report:export",
    "audit:read","audit:export",
    "billing:create","billing:read","billing:update","billing:delete",
    "settings:read","settings:update",
    "whitelabel:read","whitelabel:update",
    "security:read","security:update",
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
    "billing:create","billing:read","billing:update","report:read",
  ],
};

export function rolePermissions(role: string | null | undefined): Permission[] {
  if (!role) return [];
  if (role === TENANT_ADMIN_ROLE) return ALL_PERMS_LIST;
  return PERMS[role] ?? [];
}

export function hasPermission(role: string | null | undefined, perm: Permission): boolean {
  return rolePermissions(role).includes(perm);
}
