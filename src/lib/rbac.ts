// Mirrors `civixlab/src/lib/rbac.ts` — kept in sync so a JWT minted here
// carries the exact `permissions[]` the frontend expects on the wire.

// Roles are tenant-defined. Only "Super Admin" and "Tenant Admin" are fixed:
// Super Admin is platform-level (users.is_super_admin); Tenant Admin is
// auto-created per tenant and undeletable. Everything else is seed data.
export type Role = string;
export const SUPER_ADMIN_ROLE = "Super Admin";
export const TENANT_ADMIN_ROLE = "Tenant Admin";

// Roles that are auto-seeded into the `roles` table for every new tenant.
// "Super Admin" and "Tenant Admin" are platform-protected (the API blocks
// renames / deletes for those names). Every other role is created on
// demand by the tenant via Role Management.
export const BUILT_IN_ROLE_TEMPLATES = [
  "Super Admin",
  "Tenant Admin",
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

// Super Admin is the only role with a hardcoded permission set.
// Tenant Admin is handled by rolePermissions() below (always full perms).
// Every other role lives in the tenant_roles table and is created at
// runtime by the tenant's admin via Role Management.
const PERMS: Record<string, Permission[]> = {
  "Super Admin": ALL_PERMS_LIST,
};

export function rolePermissions(role: string | null | undefined): Permission[] {
  if (!role) return [];
  if (role === TENANT_ADMIN_ROLE) return ALL_PERMS_LIST;
  return PERMS[role] ?? [];
}

/** Union of permissions across multiple assigned roles. Order is preserved
 *  by first occurrence and duplicates are removed. */
export function rolesPermissions(roles: readonly string[] | null | undefined): Permission[] {
  if (!roles || roles.length === 0) return [];
  const seen = new Set<Permission>();
  const out: Permission[] = [];
  for (const r of roles) {
    for (const p of rolePermissions(r)) {
      if (!seen.has(p)) { seen.add(p); out.push(p); }
    }
  }
  return out;
}

export function hasPermission(role: string | null | undefined, perm: Permission): boolean {
  return rolePermissions(role).includes(perm);
}
