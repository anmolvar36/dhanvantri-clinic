import { PrismaClient } from '@prisma/client';

const globalPrisma = new PrismaClient();

// Extended client with automatic retry logic for connection drops (such as Railway idle proxy resets)
export const prisma = globalPrisma.$extends({
  query: {
    async $allOperations({ operation, args, query }) {
      let attempts = 0;
      const maxAttempts = 3;
      while (true) {
        try {
          return await query(args);
        } catch (error: any) {
          attempts++;
          const errorMessage = error?.message || '';
          const errorCode = error?.code || '';
          
          const isConnectionError = 
            errorCode === 'P1017' || 
            errorCode === 'P2024' || 
            errorMessage.includes('Server has closed the connection') ||
            errorMessage.includes('server has closed the connection') ||
            errorMessage.includes('closed the connection') ||
            errorMessage.includes('Connection closed') ||
            errorMessage.includes('connection closed') ||
            errorMessage.includes('ECONNRESET');

          if (isConnectionError && attempts < maxAttempts) {
            console.warn(`[PRISMA DB RETRY] Attempt ${attempts} failed due to connection error. Retrying in 1000ms... Error:`, errorMessage);
            await new Promise((resolve) => setTimeout(resolve, 1000));
            continue;
          }
          throw error;
        }
      }
    },
  },
});

// Periodic heartbeat to keep MySQL connections warm on Railway's TCP proxy
const heartbeat = setInterval(async () => {
  try {
    await globalPrisma.$queryRawUnsafe('SELECT 1');
  } catch (err) {
    // Silently ignore ping errors; query retry handles reconnections if they happen during a request
  }
}, 60000); // 1 minute interval

// Prevent the interval from keeping the process alive in non-server contexts (scripts/tests)
if (heartbeat && typeof heartbeat.unref === 'function') {
  heartbeat.unref();
}
