import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  // Two demo tenants so we can prove a user with multiple memberships works.
  const aramco = await prisma.tenant.upsert({
    where: { subdomain: "aramco-lab" },
    update: {},
    create: {
      name: "Saudi Aramco Materials Lab",
      subdomain: "aramco-lab",
      crNumber: "1010-700001",
      vatNumber: "300100000000003",
      subscriptionTier: "enterprise",
    },
  });

  const sabic = await prisma.tenant.upsert({
    where: { subdomain: "sabic-lab" },
    update: {},
    create: {
      name: "SABIC Quality Lab",
      subdomain: "sabic-lab",
      crNumber: "1010-700002",
      subscriptionTier: "professional",
    },
  });

  const passwordHash = await bcrypt.hash("demo1234!", 12);

  // Each entry: one user (global), and a list of (tenant, role) memberships.
  const seeds: Array<{
    email: string;
    firstName: string;
    lastName: string;
    memberships: Array<{ tenantId: string; role: string }>;
  }> = [
    { email: "fahad@aramco-lab.sa",  firstName: "Fahad",    lastName: "Al-Otaibi", memberships: [{ tenantId: aramco.id, role: "Lab Engineer" }] },
    { email: "sarah@aramco-lab.sa",  firstName: "Sarah",    lastName: "Mansour",   memberships: [{ tenantId: aramco.id, role: "Project Manager" }] },
    { email: "ahmed@aramco-lab.sa",  firstName: "Ahmed",    lastName: "Hassan",    memberships: [{ tenantId: aramco.id, role: "Lab Technician" }] },
    { email: "rashid@aramco-lab.sa", firstName: "Abdullah", lastName: "Al-Rashid", memberships: [{ tenantId: aramco.id, role: "Approver" }] },
    { email: "layla@aramco-lab.sa",  firstName: "Layla",    lastName: "Hashem",    memberships: [{ tenantId: aramco.id, role: "Quality Manager" }] },
    { email: "admin@aramco-lab.sa",  firstName: "Tenant",   lastName: "Admin",     memberships: [{ tenantId: aramco.id, role: "Tenant Admin" }] },
    // Cross-tenant user — proves the shared-user feature.
    {
      email: "consultant@civix.sa",
      firstName: "Omar",
      lastName: "Consultant",
      memberships: [
        { tenantId: aramco.id, role: "Lab Engineer" },
        { tenantId: sabic.id,  role: "Quality Manager" },
      ],
    },
  ];

  for (const s of seeds) {
    const user = await prisma.user.upsert({
      where: { email: s.email },
      update: {},
      create: {
        email: s.email,
        passwordHash,
        firstName: s.firstName,
        lastName: s.lastName,
        isActive: true,
      },
    });
    for (const m of s.memberships) {
      await prisma.userTenantMembership.upsert({
        where: { userId_tenantId: { userId: user.id, tenantId: m.tenantId } },
        update: { role: m.role, isActive: true },
        create: { userId: user.id, tenantId: m.tenantId, role: m.role },
      });
    }
  }

  console.log(`Seeded tenants: ${aramco.subdomain}, ${sabic.subdomain}`);
  console.log(`Seeded ${seeds.length} users + memberships.`);
  console.log(`Demo password for every user: demo1234!`);
  console.log(`Cross-tenant demo: consultant@civix.sa belongs to BOTH tenants.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
