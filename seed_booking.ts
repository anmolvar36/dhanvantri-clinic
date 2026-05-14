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
  console.log(`🏥 Seeding Checked-In Patient for Clinic: "${targetClinic.name}" (ID: ${clinicId})`);

  // 2. Locate the EXACT logged-in Doctor user ("doctor@gmail.com")
  const doctorUser = await prisma.user.findUnique({
    where: { email: 'doctor@gmail.com' }
  });

  if (!doctorUser) {
    console.error(`❌ User "doctor@gmail.com" not found in the database! Please run your database migrations/seeds first.`);
    return;
  }

  // Find their clinicstaff record for this clinic
  let doctorStaff = await prisma.clinicstaff.findFirst({
    where: { userId: doctorUser.id, clinicId }
  });

  if (!doctorStaff) {
    console.log(`⚠️ No clinicstaff record found for doctor@gmail.com in clinic #${clinicId}. Creating one to ensure direct mapping...`);
    doctorStaff = await prisma.clinicstaff.create({
      data: {
        clinicId,
        userId: doctorUser.id,
        role: 'DOCTOR',
        roles: JSON.stringify(['DOCTOR'])
      }
    });
  }

  const doctorId = doctorStaff.id;
  console.log(`👨‍⚕️ Linked flawlessly to "doctor@gmail.com" Staff Record ID: ${doctorId} (User ID: ${doctorUser.id})`);

  // 3. Ensure 5 distinct demo walk-in patients exist for this clinic
  const patientNames = [
    "David Husri Walk-in",
    "Ashima Demo Patient",
    "Rajesh Kumar Walk-in",
    "Elena Rostova Demo",
    "Fatima Al-Mansoor Walk-in"
  ];

  const now = new Date();
  let tokenCounter = 101;

  for (const pName of patientNames) {
    let patient = await prisma.patient.findFirst({
      where: { clinicId, name: pName }
    });

    if (!patient) {
      patient = await prisma.patient.create({
        data: {
          clinicId,
          name: pName,
          email: `walkin_${pName.toLowerCase().replace(/\s+/g, '_')}@husri.com`,
          phone: `+97150${Math.floor(1000000 + Math.random() * 9000000)}`
        }
      });
    }

    console.log(`🧑‍🤝‍🧑 Ensured Patient: "${patient.name}" (ID: ${patient.id})`);

    // Create Checked-In Appointment for Today
    const appt = await prisma.appointment.create({
      data: {
        clinicId,
        patientId: patient.id,
        doctorId,
        tokenNumber: tokenCounter++,
        date: now,
        time: `${10 + (tokenCounter - 102)}:00 AM`,
        status: 'Checked In',
        queueStatus: 'Checked-In',
        source: 'Walk-in',
        billingAmount: 200
      }
    });

    console.log(`✅ Created Checked-In Appointment #${appt.id} for ${pName}`);
  }

  console.log(`\n🎉 SUCCESS: Successfully injected 5 beautiful walk-in patients into the Waiting Room queue!`);
  console.log(`👉 Please refresh your Doctor panel at 'http://localhost:5173/doctor/assessments'.`);
  console.log(`👉 Click '+ New Assessment' to explore your rich dropdown list!`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
