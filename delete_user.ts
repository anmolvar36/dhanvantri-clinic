import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const emailToDelete = 'swift.tide6760@tembox.xyz';
    console.log(`Starting deletion for user: ${emailToDelete}`);
    try {
        // Find the user first to make sure they exist
        const user = await prisma.user.findUnique({
            where: { email: emailToDelete }
        });

        if (!user) {
            console.log(`User ${emailToDelete} not found in the database.`);
            return;
        }

        console.log(`Found user: ID=${user.id}, Role=${user.role}. Deleting...`);

        // Delete the user
        const deletedUser = await prisma.user.delete({
            where: { email: emailToDelete }
        });

        console.log(`Successfully deleted user: ${deletedUser.email}`);
    } catch (e) {
        console.error('Error during deletion:', e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
