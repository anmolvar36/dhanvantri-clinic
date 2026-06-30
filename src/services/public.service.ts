import { prisma } from '../lib/prisma.js';
import bcrypt from 'bcryptjs';
import { AppError } from '../utils/AppError.js';

export const getClinicBySubdomain = async (subdomain: string) => {
    // Allow lookup by subdomain OR id (for robustness)
    const clinic = await prisma.clinic.findFirst({
        where: {
            OR: [
                { subdomain: subdomain },
                { id: !isNaN(Number(subdomain)) ? Number(subdomain) : -1 }
            ]
        },
        select: {
            id: true,
            name: true,
            logo: true,
            location: true,
            email: true,
            contact: true,
            bookingConfig: true,
            brandingColor: true,
            modules: true
        }
    });

    if (!clinic) throw new AppError('Clinic not found', 404);

    // Parse booking config if exists
    let config = null;
    if (clinic.bookingConfig) {
        try { config = JSON.parse(clinic.bookingConfig); } catch (e) { config = null; }
    }

    return { ...clinic, bookingConfig: config };
};

export const getClinicDoctors = async (clinicId: number) => {
    return await prisma.clinicstaff.findMany({
        where: {
            clinicId,
            role: 'DOCTOR',
            user: { status: 'active' }
        },
        include: {
            user: {
                select: {
                    id: true,
                    name: true,
                    email: true
                }
            }
        }
    });
};

export const getDoctorAvailability = async (doctorId: number, date?: string) => {
    // Basic availability logic (can be expanded later with actual appointment checks)
    const staff = await prisma.clinicstaff.findUnique({
        where: { id: doctorId },
        select: { roles: true, clinicId: true }
    });

    if (!staff) throw new AppError('Doctor not found', 404);

    const clinic = await prisma.clinic.findUnique({
        where: { id: staff.clinicId },
        select: { bookingConfig: true }
    });

    let config = { timeSlots: ["09:00", "10:00", "11:00", "14:00", "15:00", "16:00"] };
    if (clinic?.bookingConfig) {
        try {
            const parsed = JSON.parse(clinic.bookingConfig);
            if (parsed.timeSlots) config.timeSlots = parsed.timeSlots;
        } catch (e) { }
    }

    return config;
};

export const createPublicBooking = async (data: any) => {
    const { name, email, phone, password, doctorId, clinicId, date, time, notes, service } = data;

    // 1. Find or Create User
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
        const hashedPassword = await bcrypt.hash(password || 'Patient@123', 12);
        user = await prisma.user.create({
            data: {
                name,
                email,
                phone,
                password: hashedPassword,
                role: 'PATIENT'
            }
        });
    }

    // 2. Ensure Patient record exists for this clinic
    let patient = await prisma.patient.findFirst({
        where: { email, clinicId }
    });

    if (!patient) {
        patient = await prisma.patient.create({
            data: {
                name,
                email,
                phone,
                clinicId,
                status: 'Active'
            }
        });
    }

    // 3. Create Appointment
    const appointment = await prisma.appointment.create({
        data: {
            clinicId,
            patientId: patient.id,
            doctorId,
            date: new Date(date),
            time,
            notes,
            service: service || 'General Consultation',
            status: 'Pending',
            source: 'Online Booking'
        }
    });

    // 4. Audit Log
    await prisma.auditlog.create({
        data: {
            action: 'Public Appointment Booked',
            performedBy: 'PATIENT',
            userId: user.id,
            clinicId,
            details: JSON.stringify({ appointmentId: appointment.id })
        }
    });

    return appointment;
};

export const getLiveTokens = async (subdomain: string) => {
    const clinic = await prisma.clinic.findFirst({
        where: {
            OR: [
                { subdomain: subdomain },
                { id: !isNaN(Number(subdomain)) ? Number(subdomain) : -1 }
            ]
        },
        select: {
            id: true,
            name: true,
            logo: true,
            brandingColor: true,
            location: true
        }
    });
    if (!clinic) throw new AppError('Clinic not found', 404);

    const now = new Date();
    // Create a robust timeframe window to absorb UTC vs Local server time offsets on Railway
    const startWindow = new Date(now.getTime() - 18 * 60 * 60 * 1000);
    const endWindow = new Date(now.getTime() + 18 * 60 * 60 * 1000);

    const appointments = await prisma.appointment.findMany({
        where: {
            clinicId: clinic.id,
            date: {
                gte: startWindow,
                lte: endWindow
            },
            tokenNumber: { not: null },
            // Automatically clear out yesterday's lingering records once they are finished
            status: { notIn: ['Completed', 'Cancelled', 'Rejected'] }
        },
        include: {
            patient: { select: { name: true } }
        },
        orderBy: { tokenNumber: 'asc' }
    });

    // Filter to isolate today's active waiting room feed
    const targetDateString = now.toISOString().split('T')[0];
    const liveQueue = appointments.filter(a => {
        const apptDateStr = new Date(a.date).toISOString().split('T')[0];
        return apptDateStr === targetDateString;
    });

    const queue = liveQueue.map(a => ({
        tokenNumber: a.tokenNumber,
        status: a.queueStatus || a.status,
        patientName: a.patient.name,
        id: a.id
    }));

    return { clinic, queue };
};
