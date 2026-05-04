import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  // Wipe every tenant-owned table explicitly, in FK-safe dependency order,
  // then drop every non-super user. Cascades would catch most of this, but
  // an explicit pass guarantees no row anywhere survives.
  const counts: Record<string, number> = {};
  counts.auditLog              = (await prisma.auditLog.deleteMany({})).count;
  counts.report                = (await prisma.report.deleteMany({})).count;
  counts.waterTest             = (await prisma.waterTest.deleteMany({})).count;
  counts.test                  = (await prisma.test.deleteMany({})).count;
  counts.testTemplate          = (await prisma.testTemplate.deleteMany({})).count;
  counts.sample                = (await prisma.sample.deleteMany({})).count;
  counts.project               = (await prisma.project.deleteMany({})).count;
  counts.equipment             = (await prisma.equipment.deleteMany({})).count;
  counts.laboratory            = (await prisma.laboratory.deleteMany({})).count;
  // Drop every roles row — the Super Admin template re-seeds itself when
  // a user signs into the tenant. Wipes audit data along with it.
  counts.role                  = (await prisma.role.deleteMany({})).count;
  counts.rolePagePermission    = (await prisma.rolePagePermission.deleteMany({})).count;
  counts.userTenantMembership  = (await prisma.userTenantMembership.deleteMany({})).count;
  counts.tenant                = (await prisma.tenant.deleteMany({})).count;
  counts.user                  = (await prisma.user.deleteMany({ where: { isSuperAdmin: false } })).count;

  // Re-create / ensure the Super Admin exists.
  const passwordHash = await bcrypt.hash("demo1234!", 12);
  await prisma.user.upsert({
    where: { email: "super@civix.sa" },
    update: { isSuperAdmin: true, isActive: true },
    create: {
      email: "super@civix.sa",
      passwordHash,
      firstName: "Civix",
      lastName: "Super",
      isSuperAdmin: true,
      isActive: true,
    },
  });

  console.log("Cleared rows:", counts);
  console.log("Super Admin ready: super@civix.sa (password: demo1234!)");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
