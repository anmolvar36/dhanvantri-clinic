import jwt from 'jsonwebtoken';
import { AppError } from '../utils/AppError.js';
import { prisma } from '../lib/prisma.js';
// ─────────────────────────────────────────────────────────────────────────────
// WASA Fix #2 + #4: protect middleware
//   • Verifies JWT signature
//   • Validates sessionToken against DB (single-session enforcement)
//   • Blocks access if session was invalidated (another login blocked this one)
// ─────────────────────────────────────────────────────────────────────────────
export const protect = async (req, res, next) => {
    try {
        let token;
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
            token = req.headers.authorization.split(' ')[1];
        }
        if (!token) {
            return next(new AppError('You are not logged in. Please log in to get access.', 401));
        }
        let decoded;
        let isExpired = false;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        }
        catch (err) {
            if (err.name === 'TokenExpiredError') {
                isExpired = true;
                decoded = jwt.decode(token);
            }
            else {
                return next(new AppError('Invalid token. Please log in again.', 401));
            }
        }
        const isLogoutRequest = req.path === '/logout' || req.originalUrl.endsWith('/logout');
        if (isLogoutRequest) {
            if (decoded && decoded.id) {
                req.user = {
                    id: Number(decoded.id),
                    email: decoded.email || '',
                    role: decoded.role || '',
                    sessionToken: decoded.sessionToken || ''
                };
                return next();
            }
        }
        if (isExpired) {
            return next(new AppError('Your session has expired. Please log in again.', 401));
        }
        // DB lookup — ensures user still exists + gets current sessionToken
        const currentUser = await prisma.user.findUnique({
            where: { id: decoded.id },
            select: {
                id: true,
                email: true,
                role: true,
                status: true,
                sessionToken: true,
                updatedAt: true
            }
        });
        if (!currentUser) {
            return next(new AppError('The user belonging to this token no longer exists.', 401));
        }
        // Block disabled/inactive users
        if (currentUser.status && currentUser.status.toLowerCase() === 'inactive') {
            return next(new AppError('Your account has been deactivated. Please contact an administrator.', 403));
        }
        // ── WASA Fix #2: Single-Session Validation ────────────────────────────
        // Every JWT embeds a sessionToken. If the DB has a DIFFERENT token,
        // this session was superseded — but per user requirement we BLOCK new logins,
        // so this check only fires if the user's DB token was cleared (logout) or
        // the stored token was changed by a login we should not have allowed.
        if (decoded.sessionToken && currentUser.sessionToken !== decoded.sessionToken) {
            return next(new AppError('Session invalidated. Please log in again.', 401));
        }
        // Touch updatedAt to keep session active (throttled to max once per minute)
        const oneMinuteAgo = new Date(Date.now() - 60000);
        if (!currentUser.updatedAt || new Date(currentUser.updatedAt) < oneMinuteAgo) {
            await prisma.user.update({
                where: { id: currentUser.id },
                data: { updatedAt: new Date() }
            });
        }
        // ─────────────────────────────────────────────────────────────────────
        req.user = {
            id: currentUser.id,
            email: currentUser.email,
            clinicId: decoded.clinicId,
            role: decoded.role || currentUser.role,
            sessionToken: decoded.sessionToken
        };
        next();
    }
    catch (error) {
        next(new AppError('Authentication failed. Please log in again.', 401));
    }
};
// ─────────────────────────────────────────────────────────────────────────────
// Role restriction
// ─────────────────────────────────────────────────────────────────────────────
export const restrictTo = (...roles) => {
    return (req, _res, next) => {
        if (!req.user || !roles.includes(req.user.role || '')) {
            return next(new AppError('You do not have permission to perform this action.', 403));
        }
        next();
    };
};
// ─────────────────────────────────────────────────────────────────────────────
// Clinic role restriction (checks clinicstaff table)
// ─────────────────────────────────────────────────────────────────────────────
export const restrictToClinicRole = (...roles) => {
    return async (req, _res, next) => {
        try {
            if (req.user?.role === 'SUPER_ADMIN')
                return next();
            if (!req.user || !req.clinicId) {
                return next(new AppError('No clinic context found. Please select a clinic.', 400));
            }
            const staffRecord = await prisma.clinicstaff.findFirst({
                where: { userId: req.user.id, clinicId: req.clinicId }
            });
            if (!staffRecord) {
                return next(new AppError('You do not have permission to perform this action.', 403));
            }
            let userRoles = [];
            try {
                userRoles = staffRecord.roles ? JSON.parse(staffRecord.roles) : [staffRecord.role];
            }
            catch {
                userRoles = [staffRecord.role];
            }
            if (!roles.some(r => userRoles.includes(r))) {
                return next(new AppError('You do not have permission to perform this action.', 403));
            }
            next();
        }
        catch (error) {
            next(error);
        }
    };
};
// ─────────────────────────────────────────────────────────────────────────────
// Clinic context resolver
// ─────────────────────────────────────────────────────────────────────────────
export const ensureClinicContext = async (req, _res, next) => {
    try {
        let clinicId = req.user?.clinicId;
        const headerId = req.headers['x-clinic-id'] ? Number(req.headers['x-clinic-id']) : undefined;
        if (req.user?.role === 'SUPER_ADMIN') {
            req.clinicId = clinicId || headerId;
            return next();
        }
        if (!clinicId && headerId) {
            const membership = await prisma.clinicstaff.findFirst({
                where: { userId: req.user.id, clinicId: headerId }
            });
            if (!membership) {
                return next(new AppError('Unauthorized: You do not belong to this clinic.', 403));
            }
            clinicId = headerId;
        }
        if (!clinicId) {
            return next(new AppError('No clinic context found. Please select a clinic.', 400));
        }
        req.clinicId = clinicId;
        next();
    }
    catch (error) {
        next(error);
    }
};
// ─────────────────────────────────────────────────────────────────────────────
// WASA Fix #1: Module access — real-time DB check on EVERY request
//   • Checks clinic's modules field from DB (not from JWT/cache)
//   • If Super Admin disabled a module mid-session → immediate 403
// ─────────────────────────────────────────────────────────────────────────────
export const requireModule = (moduleName) => {
    return async (req, _res, next) => {
        try {
            if (req.user?.role === 'SUPER_ADMIN')
                return next();
            const clinicId = req.clinicId;
            if (!clinicId)
                return next(new AppError('No clinic context found.', 400));
            const clinic = await prisma.clinic.findUnique({
                where: { id: clinicId },
                select: { modules: true, status: true }
            });
            if (!clinic)
                return next(new AppError('Clinic not found.', 404));
            // Block if clinic itself is deactivated
            if (clinic.status && clinic.status.toLowerCase() !== 'active') {
                return next(new AppError('This clinic is currently inactive.', 403));
            }
            let modules = {};
            try {
                modules = clinic.modules ? JSON.parse(clinic.modules) : {};
            }
            catch {
                modules = {};
            }
            // Normalize: 'Lab' → 'laboratory', 'Pharmacy' → 'pharmacy', etc.
            let key = moduleName.toLowerCase();
            if (key === 'lab')
                key = 'laboratory';
            if (!modules[key]) {
                return next(new AppError(`The ${moduleName} module is not enabled for this clinic.`, 403));
            }
            next();
        }
        catch (error) {
            next(error);
        }
    };
};
