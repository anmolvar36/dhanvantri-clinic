import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import * as superService from '../services/super.service.js';
import bcrypt from 'bcryptjs';
import { sendOTP } from '../services/mail.service.js';
// ==================== PLANS ====================
export const getPlans = asyncHandler(async (req, res) => {
    let plans = await prisma.subscription_plan.findMany({
        where: req.query.admin ? {} : { isActive: true },
        orderBy: { price: 'asc' }
    });
    // Auto-bootstrap defaults so plans page never stays empty.
    if (plans.length === 0) {
        await prisma.subscription_plan.createMany({
            data: [
                {
                    name: 'Starter',
                    price: 99,
                    duration: 'Monthly',
                    features: JSON.stringify(['Appointments', 'Billing', 'Patient Records']),
                    isActive: true
                },
                {
                    name: 'Professional',
                    price: 199,
                    duration: 'Monthly',
                    features: JSON.stringify(['Everything in Starter', 'Lab', 'Radiology', 'Pharmacy']),
                    isActive: true
                },
                {
                    name: 'Enterprise',
                    price: 499,
                    duration: 'Monthly',
                    features: JSON.stringify(['Everything in Professional', 'Multi Clinic', 'Priority Support']),
                    isActive: true
                }
            ]
        });
        plans = await prisma.subscription_plan.findMany({
            where: req.query.admin ? {} : { isActive: true },
            orderBy: { price: 'asc' }
        });
    }
    res.status(200).json({ success: true, data: plans });
});
export const createPlan = asyncHandler(async (req, res) => {
    const { name, price, duration, features } = req.body;
    const plan = await prisma.subscription_plan.create({
        data: {
            name,
            price,
            duration,
            features: JSON.stringify(features)
        }
    });
    res.status(201).json({ success: true, message: 'Plan created successfully', data: plan });
});
export const updatePlan = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { name, price, duration, features, isActive } = req.body;
    const plan = await prisma.subscription_plan.update({
        where: { id: Number(id) },
        data: {
            name,
            price,
            duration,
            features: typeof features === 'string' ? features : JSON.stringify(features),
            isActive
        }
    });
    res.status(200).json({ success: true, message: 'Plan updated successfully', data: plan });
});
export const deletePlan = asyncHandler(async (req, res) => {
    const { id } = req.params;
    // Check if any registrations are using it. For MVP we'll just delete.
    await prisma.subscription_plan.delete({
        where: { id: Number(id) }
    });
    res.status(200).json({ success: true, message: 'Plan deleted successfully' });
});
// ==================== REGISTRATIONS ====================
export const createRegistration = asyncHandler(async (req, res) => {
    const { firstName, lastName, email, password, address, planId, userType } = req.body;
    if (!firstName || !email || !password) {
        throw new AppError('Missing required fields', 400);
    }
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
        throw new AppError('Email already in use', 400);
    }
    if (userType === 'PATIENT') {
        if (!req.body.clinicId) {
            throw new AppError('Please select a target clinic to complete your patient registration.', 400);
        }
        const targetClinic = await prisma.clinic.findUnique({
            where: { id: Number(req.body.clinicId) }
        });
        if (!targetClinic) {
            throw new AppError('The selected clinic does not exist.', 404);
        }
        // Direct Patient Creation
        const hashedPassword = await bcrypt.hash(password, 10);
        const name = `${firstName} ${lastName}`.trim();
        const user = await prisma.user.create({
            data: {
                email,
                name: name,
                password: hashedPassword,
                role: 'PATIENT',
                status: 'active'
            }
        });
        await prisma.patient.create({
            data: {
                name,
                email,
                address,
                phone: '0000000000', // Default phone
                clinicId: targetClinic.id
            }
        });
        return res.status(201).json({
            success: true,
            message: 'Patient account created successfully. You can now login.',
            data: { id: user.id, email: user.email, role: 'PATIENT' }
        });
    }
    // Admin Flow (Approval Needed)
    const reqData = await prisma.registration_request.create({
        data: {
            firstName,
            lastName,
            email,
            password, // Approved flow typically uses registration password during clinic create
            address,
            planId: planId ? Number(planId) : null,
            status: 'PENDING'
        }
    });
    res.status(201).json({ success: true, message: 'Registration submitted successfully. Waiting for Admin approval.', data: reqData });
});
export const getRegistrations = asyncHandler(async (req, res) => {
    const requests = await prisma.registration_request.findMany({
        orderBy: { createdAt: 'desc' },
        include: { plan: true }
    });
    res.status(200).json({ success: true, data: requests });
});
export const approveRegistration = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const registration = await prisma.registration_request.findUnique({
        where: { id: Number(id) },
        include: { plan: true }
    });
    if (!registration)
        throw new AppError('Registration request not found', 404);
    if (registration.status !== 'PENDING')
        throw new AppError('Request is not in PENDING state', 400);
    // Create a new clinic for this registration
    const clinicName = `${registration.firstName}'s Clinic`;
    // Convert duration to months
    let durationInMonths = 1;
    let planType = 'Monthly';
    if (registration.plan) {
        if (registration.plan.duration.toLowerCase().includes('year')) {
            durationInMonths = 12;
            planType = 'Yearly';
        }
        else if (registration.plan.duration.toLowerCase().includes('month')) {
            durationInMonths = 1;
        }
        else {
            planType = registration.plan.name;
        }
    }
    const clinicData = {
        name: clinicName,
        location: registration.address || 'N/A', // Use address from registration as clinic location
        email: registration.email,
        contact: '0000000000', // Default or ask in form
        password: registration.password,
        subscriptionDuration: durationInMonths,
        subscriptionPlan: planType,
        numberOfUsers: 5, // Default limit
        subscriptionAmount: registration.plan ? registration.plan.price : 99,
        gstPercent: 0
    };
    // Use existing service to create clinic & admin user
    const clinic = await superService.createClinic(clinicData);
    // Mark registration as approved
    await prisma.registration_request.update({
        where: { id: Number(id) },
        data: { status: 'APPROVED' }
    });
    res.status(200).json({ success: true, message: 'Registration approved and Clinic created', data: clinic });
});
export const rejectRegistration = asyncHandler(async (req, res) => {
    const { id } = req.params;
    await prisma.registration_request.update({
        where: { id: Number(id) },
        data: { status: 'REJECTED' }
    });
    res.status(200).json({ success: true, message: 'Registration rejected' });
});
// ==================== REGISTRATION OTP VERIFICATION ====================
/**
 * Step 1: Form data receive karo → Email already exist check karo → OTP bhejo
 * Account abhi nahi banega, sirf OTP verify hoga
 */
export const sendRegistrationOtp = asyncHandler(async (req, res) => {
    const { firstName, lastName, email, password, address, planId, userType, clinicId } = req.body;
    if (!firstName || !email || !password || !userType) {
        throw new AppError('Missing required fields', 400);
    }
    // Email already use ho raha hai check karo
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser && existingUser.status !== 'pending_verification') {
        throw new AppError('This email is already registered. Please login instead.', 400);
    }
    // Patient ke liye clinic mandatory hai
    if (userType === 'PATIENT' && !clinicId) {
        throw new AppError('Please select your target clinic to complete patient registration.', 400);
    }
    // OTP generate karo (6 digit)
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    const hashedPassword = await bcrypt.hash(password, 10);
    const name = `${firstName} ${lastName}`.trim();
    if (existingUser && existingUser.status === 'pending_verification') {
        // Pehle se pending user hai — OTP update karo
        await prisma.user.update({
            where: { email },
            data: { otp, otpExpiry, password: hashedPassword, name }
        });
    }
    else {
        // Naya pending user banao (account abhi activate nahi hoga)
        await prisma.user.create({
            data: {
                email,
                name,
                password: hashedPassword,
                role: userType === 'PATIENT' ? 'PATIENT' : 'ADMIN',
                status: 'pending_verification',
                otp,
                otpExpiry
            }
        });
    }
    // OTP email bhejo (background mein — login flow jaise)
    void Promise.resolve()
        .then(() => sendOTP(email, otp))
        .catch(() => { });
    console.log(`[REGISTRATION OTP] Sent to ${email}: ${otp}`); // Dev log
    res.status(200).json({
        success: true,
        message: `Verification code sent to ${email}. Please check your email.`,
        data: { email, userType }
    });
});
/**
 * Step 2: OTP verify karo → Sahi hai toh:
 *   - Patient: User active + patient record banao
 *   - Admin: registration_request (PENDING) banao
 */
export const verifyAndRegister = asyncHandler(async (req, res) => {
    const { email, otp, firstName, lastName, address, planId, userType, clinicId } = req.body;
    if (!email || !otp) {
        throw new AppError('Email and OTP are required', 400);
    }
    // User dhundho
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.status !== 'pending_verification') {
        throw new AppError('No pending registration found. Please start registration again.', 400);
    }
    // OTP expiry check karo
    if (!user.otpExpiry || new Date() > user.otpExpiry) {
        throw new AppError('Verification code has expired. Please request a new one.', 400);
    }
    // OTP match karo
    const otpString = String(otp || '').trim();
    if (!user.otp || String(user.otp) !== otpString) {
        throw new AppError('Invalid verification code. Please check your email and try again.', 400);
    }
    // OTP clear karo
    await prisma.user.update({
        where: { email },
        data: { otp: null, otpExpiry: null }
    });
    if (userType === 'PATIENT') {
        // ── Patient Flow ──────────────────────────────────────────────────────
        if (!clinicId) {
            throw new AppError('Clinic selection is required for patient registration.', 400);
        }
        const targetClinic = await prisma.clinic.findUnique({
            where: { id: Number(clinicId) }
        });
        if (!targetClinic) {
            throw new AppError('The selected clinic does not exist.', 404);
        }
        // User ko active karo
        await prisma.user.update({
            where: { email },
            data: { status: 'active' }
        });
        // Patient record banao
        await prisma.patient.create({
            data: {
                name: user.name,
                email,
                address: address || '',
                phone: '0000000000',
                clinicId: targetClinic.id
            }
        });
        return res.status(201).json({
            success: true,
            message: '✅ Account successfully created! You can now login with your email and password.',
            data: { email, role: 'PATIENT', userType: 'PATIENT' }
        });
    }
    else {
        // ── Admin / SaaS Flow ─────────────────────────────────────────────────
        // User delete karo (registration_request use karenge instead)
        await prisma.user.delete({ where: { email } });
        // Registration request banao (SuperAdmin approve karega)
        const reqData = await prisma.registration_request.create({
            data: {
                firstName: firstName || user.name.split(' ')[0],
                lastName: lastName || user.name.split(' ').slice(1).join(' ') || '',
                email,
                password: user.password, // hashed password
                address: address || '',
                planId: planId ? Number(planId) : null,
                status: 'PENDING'
            }
        });
        return res.status(201).json({
            success: true,
            message: '✅ Registration request submitted! Please wait for SuperAdmin approval before logging in.',
            data: { email, userType: 'ADMIN', requestId: reqData.id }
        });
    }
});
/**
 * OTP resend karo (registration ke dauran)
 */
export const resendRegistrationOtp = asyncHandler(async (req, res) => {
    const { email } = req.body;
    if (!email) {
        throw new AppError('Email is required', 400);
    }
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.status !== 'pending_verification') {
        throw new AppError('No pending registration found for this email.', 400);
    }
    // Naya OTP generate karo
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
    await prisma.user.update({
        where: { email },
        data: { otp, otpExpiry }
    });
    void Promise.resolve()
        .then(() => sendOTP(email, otp))
        .catch(() => { });
    console.log(`[REGISTRATION OTP RESEND] Sent to ${email}: ${otp}`);
    res.status(200).json({
        success: true,
        message: `New verification code sent to ${email}.`
    });
});
