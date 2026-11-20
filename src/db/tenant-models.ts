/**
 * Prisma models whose rows belong to one company (they have a non-null
 * `tenantId`). The tenant-scoping extension in prisma.ts filters these by the
 * active company. Kept in its own dependency-free file so a test can compare it
 * with schema.prisma (see tenant-models.test.ts).
 *
 * TestTemplate is intentionally absent: its tenantId is nullable (null = global).
 */
export const TENANT_MODELS = new Set([
  "UserTenantMembership", "Project", "Sample", "Test", "WaterTest", "Equipment",
  "AuditLog", "Report", "Role", "RolePagePermission", "Laboratory", "Department",
  "Client", "Engineer",
]);

/** Models that have a tenantId column but are deliberately not auto-scoped. */
export const TENANT_ID_EXEMPT = new Set(["TestTemplate"]);
