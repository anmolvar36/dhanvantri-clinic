// Migration: Add sessionToken to user table
// Uses existing Prisma client from the project

import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();

async function migrate() {
    try {
        console.log('🔄 Running migration: add sessionToken to user table...');

        // Check if column exists first
        const result: any[] = await prisma.$queryRawUnsafe(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
             WHERE TABLE_SCHEMA = DATABASE() 
             AND TABLE_NAME = 'user' 
             AND COLUMN_NAME = 'sessionToken'`
        );

        if (result.length > 0) {
            console.log('✅ sessionToken column already exists — no action needed.');
        } else {
            await prisma.$executeRawUnsafe(
                'ALTER TABLE `user` ADD COLUMN `sessionToken` VARCHAR(191) NULL'
            );
            console.log('✅ SUCCESS: sessionToken column added to user table!');
        }
    } catch (e: any) {
        console.error('❌ Migration failed:', e.message);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

migrate();
