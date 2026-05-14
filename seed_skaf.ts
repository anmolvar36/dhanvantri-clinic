import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // 1. Resolve Target Clinic (Skaf Clinic or fallback)
  const clinics = await prisma.clinic.findMany();
  const targetClinic = clinics.find(c => c.name.toLowerCase().includes('skaf')) || clinics[0];
  if (!targetClinic) {
    console.error("❌ No clinics found in database!");
    return;
  }
  const clinicId = targetClinic.id;
  console.log(`🎯 Populating Union Test Data for Facility: "${targetClinic.name}" (ID: ${clinicId})`);

  // 2. Fetch linked patient
  let patient = await prisma.patient.findFirst({ where: { clinicId } });
  if (!patient) {
    patient = await prisma.patient.create({
      data: { clinicId, name: 'Skaf Demo Patient', email: `p_${clinicId}@skaf.demo`, phone: '1234567890' }
    });
  }

  // 3. SEED SOURCE A: Standalone Service Order (Walk-ins/Direct Prescriptions)
  const so = await prisma.service_order.create({
    data: {
      clinicId,
      patientId: patient.id,
      doctorId: 0,
      type: 'PHARMACY',
      testName: 'Ciprofloxacin 500mg x2',
      testStatus: 'Completed',
      paymentStatus: 'Paid',
      amount: 45.00,
      result: JSON.stringify({
        amount: 45.00,
        items: [{ medicineName: 'Ciprofloxacin 500mg', quantity: 2, unitPrice: 22.50 }]
      })
    }
  });
  console.log(`📦 Seeded Source A (service_order): Row ID #${so.id} | Amount: ¥45.00`);

  // 4. SEED SOURCE B: Official Billing Invoice containing Pharmacy invoice_items
  const invId = `INV-SKAF-${Date.now().toString().slice(-5)}`;
  const inv = await prisma.invoice.create({
    data: {
      id: invId,
      clinicId,
      patientId: patient.id,
      totalAmount: 120.00,
      status: 'Paid',
      items: {
        create: [
          {
            serviceType: 'pharmacy',
            description: 'Amoxicillin 500mg x3',
            amount: 120.00
          }
        ]
      }
    }
  });
  console.log(`🧾 Seeded Source B (invoice): Row ID #${inv.id} | Amount: ¥120.00`);

  console.log(`\n🎉 SUCCESS: Both data streams injected successfully for today's date!`);
  console.log(`👉 Please access 'http://localhost:5173/pharmacy/reports' to see the combined union sum perfectly aggregate to ¥165.00!`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
