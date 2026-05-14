import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const patient = await prisma.patient.findFirst({ where: { clinicId: 1 } });
  const patientId = patient ? patient.id : 1;

  const invItems = await prisma.inventory.findMany({
    where: { clinicId: 1 }, take: 2
  });

  const med1 = invItems[0] || { name: 'Amoxicillin 500mg', unitPrice: 15.50, sku: 'SKU-AMX-500' };
  const med2 = invItems[1] || { name: 'Paracetamol 650mg', unitPrice: 5.00, sku: 'SKU-PAR-650' };

  const totalAmount = (med1.unitPrice * 2) + (med2.unitPrice * 1);

  const newOrder = await prisma.service_order.create({
    data: {
      clinicId: 1,
      patientId: patientId,
      doctorId: 0,
      type: 'PHARMACY',
      testName: `${med1.name}, ${med2.name}`,
      testStatus: 'Completed',
      paymentStatus: 'Paid',
      amount: totalAmount,
      result: JSON.stringify({
        amount: totalAmount,
        items: [
          { medicineName: med1.name, quantity: 2, unitPrice: med1.unitPrice, sku: med1.sku },
          { medicineName: med2.name, quantity: 1, unitPrice: med2.unitPrice, sku: med2.sku }
        ]
      })
    }
  });

  console.log(`🎉 Successfully created perfect pre-completed order row ID #${newOrder.id}!`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
