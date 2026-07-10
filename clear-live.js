import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "mysql://root:IGDGbyvnfjvhJeZpBzobVwzChzBsxDrE@yamanote.proxy.rlwy.net:34059/railway"
    }
  }
});

async function runWithRetry(fn, attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      console.warn(`[RETRY] Attempt ${i + 1} failed: ${err.message || err}`);
      if (i === attempts - 1) throw err;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

async function main() {
  try {
    console.log("Connecting to Railway Live Database...");
    await runWithRetry(async () => {
      const user = await prisma.user.findUnique({
        where: { email: 'superadmin@gmail.com' }
      });
      if (!user) {
        console.log("User not found on live database!");
        return;
      }
      console.log("Current sessionToken on Live DB:", user.sessionToken);
      console.log("Clearing sessionToken on Live DB...");
      await prisma.user.update({
        where: { id: user.id },
        data: { sessionToken: null }
      });
      console.log("SUCCESS! Live database sessionToken cleared.");
    });
  } catch (error) {
    console.error("ERROR CONNECTING/CLEARING LIVE SESSION:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
