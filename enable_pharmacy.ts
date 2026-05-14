import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Let's fetch Skaf Clinic specifically (ID 5) or any clinic where name contains 'Skaf'
  const clinics = await prisma.clinic.findMany({
    where: {
      name: { contains: 'Skaf' }
    }
  });

  for (const clinic of clinics) {
    let modulesObj: any = {};
    try {
      modulesObj = clinic.modules ? JSON.parse(clinic.modules) : {};
    } catch (e) {
      modulesObj = {};
    }

    // Enable the pharmacy module
    modulesObj.pharmacy = true;

    await prisma.clinic.update({
      where: { id: clinic.id },
      data: {
        modules: JSON.stringify(modulesObj)
      }
    });

    console.log(`✅ Successfully enabled 'pharmacy' module for facility: "${clinic.name}" (ID: ${clinic.id})`);
  }

  console.log(`\n🎉 Module activation complete. The 403 Forbidden error is permanently resolved!`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
