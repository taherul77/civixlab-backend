import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.upsert({
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

  const passwordHash = await bcrypt.hash("demo1234!", 12);
  for (const u of [
    { email: "fahad@aramco-lab.sa",  role: "Lab Engineer",     firstName: "Fahad",   lastName: "Al-Otaibi" },
    { email: "sarah@aramco-lab.sa",  role: "Project Manager",  firstName: "Sarah",   lastName: "Mansour" },
    { email: "ahmed@aramco-lab.sa",  role: "Lab Technician",   firstName: "Ahmed",   lastName: "Hassan" },
    { email: "rashid@aramco-lab.sa", role: "Approver",         firstName: "Abdullah",lastName: "Al-Rashid" },
    { email: "layla@aramco-lab.sa",  role: "Quality Manager",  firstName: "Layla",   lastName: "Hashem" },
    { email: "admin@aramco-lab.sa",  role: "Tenant Admin",     firstName: "Tenant",  lastName: "Admin" },
  ]) {
    await prisma.user.upsert({
      where: { tenantId_email: { tenantId: tenant.id, email: u.email } },
      update: {},
      create: {
        tenantId: tenant.id,
        email: u.email,
        passwordHash,
        firstName: u.firstName,
        lastName: u.lastName,
        role: u.role,
        isActive: true,
      },
    });
  }

  console.log(`Seeded tenant ${tenant.subdomain} (id=${tenant.id}) + 6 demo users.`);
  console.log(`Demo password for every user: demo1234!`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
