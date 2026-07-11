import { Request, Response } from 'express';
import { AuthRequest } from '../middlewares/auth.js';
import * as authService from '../services/auth.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const getClientInfo = (req: any) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const rawDevice = req.headers['user-agent'] || 'unknown';
    const device = rawDevice.length > 150 ? rawDevice.substring(0, 150) + '...' : rawDevice;
    return { ip: Array.isArray(ip) ? ip[0] : ip, device };
};

export const login = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { ip, device } = getClientInfo(req);
    console.log(`[LOGIN CONTROLLER] Body:`, JSON.stringify(req.body));

    try {
        const result = await authService.login(req.body, ip, device);
        console.log('Login backend result successful');
        res.status(200).json({
            success: true,
            message: result?.otpRequired ? 'Verification code sent to email' : 'Login successful',
            data: result
        });
    } catch (error: any) {
        console.error(`[LOGIN CONTROLLER ERROR]`, error);
        throw error; // Let the global handler take it, but now it's logged
    }
});

export const verifyOTP = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { ip, device } = getClientInfo(req);
    const result = await authService.verifyOTP(req.body, ip, device);
    res.status(200).json({
        success: true,
        message: 'Verification successful',
        data: result
    });
});

export const resendOTP = asyncHandler(async (req: AuthRequest, res: Response) => {
    const result = await authService.resendOTP(req.body.email);
    res.status(200).json({
        success: true,
        message: 'New verification code sent',
        data: result
    });
});

export const getMyClinics = asyncHandler(async (req: AuthRequest, res: Response) => {
    const clinics = await authService.getMyClinics(req.user!.id);
    res.status(200).json({
        success: true,
        data: clinics
    });
});

export const selectClinic = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { ip, device } = getClientInfo(req);
    const { clinicId, role } = req.body;
    const result = await authService.selectClinic(req.user!.id, clinicId, role, ip, device);
    res.status(200).json({
        success: true,
        message: 'Clinic context locked',
        data: result
    });
});

export const forgotPassword = asyncHandler(async (req: AuthRequest, res: Response) => {
    const result = await authService.forgotPassword(req.body.email);
    res.status(200).json({
        success: true,
        message: result.message
    });
});

export const resetPassword = asyncHandler(async (req: AuthRequest, res: Response) => {
    const result = await authService.resetPassword(req.body);
    res.status(200).json({
        success: true,
        message: result.message
    });
});

export const changePassword = asyncHandler(async (req: AuthRequest, res: Response) => {
    const result = await authService.changePassword(req.user!.id, req.body);
    res.status(200).json({
        success: true,
        message: result.message
    });
});

export const refreshToken = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { refreshToken: tokenStr } = req.body;
    if (!tokenStr) {
        throw new Error('Refresh token is required');
    }
    const result = await authService.refreshAccessToken(tokenStr);
    res.status(200).json({
        success: true,
        data: result
    });
});

export const impersonate = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { ip, device } = getClientInfo(req);
    const result = await authService.impersonate(req.user!.id, req.body.userId, ip, device);
    res.status(200).json({
        success: true,
        message: 'Impersonation successful',
        data: result
    });
});

// WASA Fix #2: Logout — clears session token so account is available for next login
export const logout = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { ip, device } = getClientInfo(req);
    const result = await authService.logout(req.user!.id, ip, device);
    res.status(200).json({
        success: true,
        message: result.message
    });
});

import { prisma } from '../lib/prisma.js';

export const clearLiveSessions = asyncHandler(async (req: Request, res: Response) => {
    await prisma.user.updateMany({
        data: { sessionToken: null }
    });
    res.status(200).json({
        success: true,
        message: 'All user sessions cleared successfully on live!'
    });
});

export const deleteMukulData = asyncHandler(async (req: Request, res: Response) => {
    const email = 'mukulkiaantechnology@gmail.com';
    const log: string[] = [];

    log.push(`Starting deletion workflow for: ${email}`);

    try {
        // 1. Find all users matching this email
        const users = await prisma.user.findMany({
            where: { email }
        });
        log.push(`Found ${users.length} users matching ${email}.`);

        for (const user of users) {
            log.push(`Cleaning up records for user ID ${user.id}...`);
            
            // Delete related tables where user is foreign key (try/catch each to make it robust)
            try {
                const uAudit = await prisma.auditlog.deleteMany({ where: { userId: user.id } });
                log.push(`- Deleted ${uAudit.count} auditlogs for user.`);
            } catch (err: any) {
                log.push(`- Skip auditlog for user: ${err.message}`);
            }

            try {
                const uStaff = await prisma.clinicstaff.deleteMany({ where: { userId: user.id } });
                log.push(`- Deleted ${uStaff.count} clinicstaff records for user.`);
            } catch (err: any) {
                log.push(`- Skip clinicstaff for user: ${err.message}`);
            }

            try {
                const uReports = await prisma.medical_report.deleteMany({ where: { doctorId: user.id } });
                log.push(`- Deleted ${uReports.count} medical reports where user was doctor.`);
            } catch (err: any) {
                log.push(`- Skip medical_report for user: ${err.message}`);
            }

            try {
                const uShortcuts = (prisma as any).doctor_shortcuts 
                    ? await (prisma as any).doctor_shortcuts.deleteMany({ where: { userId: user.id } })
                    : { count: 0 };
                log.push(`- Deleted ${uShortcuts.count} doctor shortcuts for user.`);
            } catch (err: any) {
                log.push(`- Skip doctor_shortcuts for user: ${err.message}`);
            }
        }

        // 2. Find all clinics matching this email
        const clinics = await prisma.clinic.findMany({
            where: { email }
        });
        log.push(`Found ${clinics.length} clinics matching ${email}.`);

        for (const clinic of clinics) {
            log.push(`Cleaning up records for clinic ID ${clinic.id}...`);

            const deleteClinicScoped = async (name: string, model: any) => {
                try {
                    if (model && typeof model.deleteMany === 'function') {
                        const res = await model.deleteMany({ where: { clinicId: clinic.id } });
                        log.push(`- Deleted ${res.count} ${name}.`);
                    }
                } catch (err: any) {
                    log.push(`- Skip ${name}: ${err.message}`);
                }
            };

            // Delete clinic-dependent records
            await deleteClinicScoped('appointments', prisma.appointment);
            await deleteClinicScoped('clinic auditlogs', prisma.auditlog);

            // Get all staff user IDs in the clinic to clean them up if they don't belong to any other clinic
            let userIdsToDelete: number[] = [];
            try {
                const staffList = await prisma.clinicstaff.findMany({ where: { clinicId: clinic.id } });
                userIdsToDelete = staffList.map(s => s.userId);
            } catch (err: any) {
                log.push(`- Skip getting staff list: ${err.message}`);
            }

            await deleteClinicScoped('clinicstaff records', prisma.clinicstaff);
            await deleteClinicScoped('departments', prisma.department);
            await deleteClinicScoped('form responses', (prisma as any).formresponse);
            await deleteClinicScoped('form templates', (prisma as any).formtemplate);
            await deleteClinicScoped('inventory items', prisma.inventory);
            await deleteClinicScoped('invoices', prisma.invoice);
            await deleteClinicScoped('medical records', prisma.medicalrecord);
            await deleteClinicScoped('medical reports', prisma.medical_report);
            await deleteClinicScoped('notifications', prisma.notification);
            await deleteClinicScoped('patient documents', (prisma as any).patient_document);
            await deleteClinicScoped('patients', prisma.patient);
            await deleteClinicScoped('service orders', prisma.service_order);
            await deleteClinicScoped('staff documents', (prisma as any).staff_document);
            await deleteClinicScoped('subscription invoices', prisma.subscription_invoice);
            await deleteClinicScoped('medical report templates', (prisma as any).medical_report_templates);
            await deleteClinicScoped('clinic services', (prisma as any).clinic_service);
            await deleteClinicScoped('doctor shortcuts', (prisma as any).doctor_shortcuts);

            // Delete the clinic itself
            try {
                await prisma.clinic.delete({ where: { id: clinic.id } });
                log.push(`- Deleted clinic ID ${clinic.id} itself.`);
            } catch (err: any) {
                log.push(`- Error deleting clinic itself: ${err.message}`);
            }

            // Now clean up staff users who were only in this clinic
            for (const uId of userIdsToDelete) {
                try {
                    const otherAssociations = await prisma.clinicstaff.count({ where: { userId: uId } });
                    if (otherAssociations === 0) {
                        const u = await prisma.user.findUnique({ where: { id: uId } });
                        if (u && u.email !== email) { // Main user will be deleted in the next step
                            try { await prisma.auditlog.deleteMany({ where: { userId: uId } }); } catch(e){}
                            try { if ((prisma as any).doctor_shortcuts) await (prisma as any).doctor_shortcuts.deleteMany({ where: { userId: uId } }); } catch(e){}
                            await prisma.user.delete({ where: { id: uId } });
                            log.push(`- Deleted orphaned staff user: ${u.email} (ID ${uId})`);
                        }
                    }
                } catch (err: any) {
                    log.push(`- Skip staff user ${uId} cleanup: ${err.message}`);
                }
            }
        }

        // 3. Delete users themselves
        for (const user of users) {
            try {
                await prisma.user.delete({ where: { id: user.id } });
                log.push(`Deleted user ${user.email} (ID ${user.id}).`);
            } catch (err: any) {
                log.push(`- Error deleting user ID ${user.id}: ${err.message}`);
            }
        }

        // 4. Delete registration request
        try {
            const delReg = await prisma.registration_request.deleteMany({
                where: { email }
            });
            log.push(`Deleted ${delReg.count} registration requests for ${email}.`);
        } catch (err: any) {
            log.push(`- Error deleting registration requests: ${err.message}`);
        }

        res.status(200).json({
            success: true,
            message: `Successfully deleted user ${email} and all associated data from the live database.`,
            log
        });
    } catch (error: any) {
        log.push(`Error during deletion: ${error.message}`);
        res.status(500).json({
            success: false,
            message: 'An error occurred during deletion on the live database.',
            error: error.message,
            log
        });
    }
});



