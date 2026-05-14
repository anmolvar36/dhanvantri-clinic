import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // 1. Locate Husri Clinic
  const clinics = await prisma.clinic.findMany();
  const targetClinic = clinics.find(c => c.name.toLowerCase().includes('husri')) || clinics[0];
  if (!targetClinic) {
    console.error("❌ No clinics found!");
    return;
  }
  const clinicId = targetClinic.id;
  console.log(`🏥 Seeding Queue Display Test Data for Clinic: "${targetClinic.name}" (ID: ${clinicId})`);

  // 2. Locate a Doctor user/staff
  const doctorStaff = await prisma.clinicstaff.findFirst({
    where: { clinicId, role: 'DOCTOR' }
  });

  if (!doctorStaff) {
    console.error(`❌ No doctor found for clinic #${clinicId}. Please ensure staff exists.`);
    return;
  }
  const doctorId = doctorStaff.id;

  // 3. Define target dates: Yesterday, Today, Tomorrow
  const now = new Date();
  
  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);

  const tomorrow = new Date();
  tomorrow.setDate(now.getDate() + 1);

  const testCases = [
    { name: "Alice Yesterday Test", date: yesterday, token: 50, status: "Checked In", desc: "Past date (Should NOT appear on live TV screen today)" },
    { name: "Bob Today Live Test", date: now, token: 1, status: "Checked In", desc: "Today's date (MUST appear on live TV screen instantly)" },
    { name: "Charlie Future Test", date: tomorrow, token: 201, status: "Checked In", desc: "Future date (Should NOT appear on live TV screen today)" }
  ];

  for (const tc of testCases) {
    // Ensure patient exists
    let patient = await prisma.patient.findFirst({
      where: { clinicId, name: tc.name }
    });

    if (!patient) {
      patient = await prisma.patient.create({
        data: {
          clinicId,
          name: tc.name,
          email: `${tc.name.toLowerCase().replace(/\s+/g, '_')}@test.com`,
          phone: `+97150${Math.floor(1000000 + Math.random() * 9000000)}`
        }
      });
    }

    // Create checked-in appointment with token
    const appt = await prisma.appointment.create({
      data: {
        clinicId,
        patientId: patient.id,
        doctorId,
        tokenNumber: tc.token,
        date: tc.date,
        time: tc.date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        status: tc.status,
        queueStatus: 'Checked-In',
        source: 'Queue Automation Test',
        billingAmount: 150
      }
    });

    console.log(`✅ Created Appointment #${appt.id} for "${tc.name}" on ${tc.date.toISOString().split('T')[0]} with Token #${tc.token}`);
    console.log(`   👉 ${tc.desc}\n`);
  }

  console.log(`🎉 SUCCESS: Successfully seeded Past, Today, and Future queue display verification data!`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
