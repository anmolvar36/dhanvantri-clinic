import { AppError } from '../utils/AppError.js';
// ─────────────────────────────────────────────────────────────────────────────
// WASA Fix #3: Centralized Production-Safe Error Handler
//
// In PRODUCTION:
//   • Operational errors (AppError) → show exact message (user-facing)
//   • Programmer/DB/unknown errors → show ONLY "Internal Server Error"
//   • NO stack traces, NO DB names, NO framework details in response
//
// In DEVELOPMENT:
//   • Full error details shown for debugging
// ─────────────────────────────────────────────────────────────────────────────
const isProd = process.env.NODE_ENV === 'production';
// Sanitize Prisma/DB errors — strip DB details before logging
const sanitizePrismaError = (err) => {
    const msg = err?.message || '';
    // Remove Prisma connection string leaks
    if (msg.includes('prisma') || msg.includes('P2') || msg.includes('MySQL')) {
        return 'A database operation failed. Please try again.';
    }
    return 'Internal Server Error';
};
export const globalErrorHandler = (err, _req, res, _next) => {
    const statusCode = err.statusCode || 500;
    // Always log full error on server (never in response)
    if (statusCode >= 500) {
        console.error(`[ERROR] ${new Date().toISOString()} | Status: ${statusCode}`);
        console.error(err);
    }
    else {
        // Log 4xx at warn level
        console.warn(`[WARN] ${new Date().toISOString()} | Status: ${statusCode} | ${err.message}`);
    }
    // ── PRODUCTION ────────────────────────────────────────────────────────────
    if (isProd) {
        // Operational errors (our AppError) — safe to show message
        if (err instanceof AppError && err.isOperational) {
            return res.status(statusCode).json({
                success: false,
                status: err.status,
                message: err.message
            });
        }
        // JWT errors — safe operational message
        if (err.name === 'JsonWebTokenError') {
            return res.status(401).json({
                success: false,
                status: 'fail',
                message: 'Invalid authentication token. Please log in again.'
            });
        }
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                status: 'fail',
                message: 'Your session has expired. Please log in again.'
            });
        }
        // Multer file upload errors
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                status: 'fail',
                message: 'File is too large. Maximum allowed size is 2MB.'
            });
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
            return res.status(400).json({
                success: false,
                status: 'fail',
                message: 'Unexpected file field in upload.'
            });
        }
        // Unknown/programmer errors — NEVER expose details
        return res.status(500).json({
            success: false,
            status: 'error',
            message: 'Internal Server Error'
        });
    }
    // ── DEVELOPMENT ───────────────────────────────────────────────────────────
    return res.status(statusCode).json({
        success: false,
        status: err.status || 'error',
        message: err.message || 'Internal Server Error',
        stack: err.stack,
        error: err
    });
};
