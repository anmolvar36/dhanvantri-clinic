import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { AppError } from './AppError.js';
// ─────────────────────────────────────────────────────────────────────────────
// WASA Fix #5: Secure File Upload Configuration
//
// Defenses applied:
//   1. MIME type whitelist (jpg, jpeg, png, webp only)
//   2. Magic byte verification — reads first bytes of file buffer to confirm
//      actual file type, defeats extension/MIME spoofing attacks
//   3. File size limit: 2MB
//   4. Secure random filename using crypto.randomUUID()
//   5. No user-controlled path components in filename
// ─────────────────────────────────────────────────────────────────────────────
// Ensure upload directory exists
const uploadDir = path.join(process.cwd(), 'uploads', 'logos');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}
// Allowed MIME types for Logo uploads (Images only)
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
// Magic byte signatures for JPEG/PNG/WEBP validation
const MAGIC_BYTES = {
    'image/jpeg': [Buffer.from([0xff, 0xd8, 0xff])],
    'image/jpg': [Buffer.from([0xff, 0xd8, 0xff])],
    'image/png': [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    'image/webp': [Buffer.from([0x52, 0x49, 0x46, 0x46])], // RIFF
};
/**
 * Validates actual file magic bytes against declared MIME type.
 * Prevents attacks where a malicious file is renamed and spoofed.
 */
const validateMagicBytes = (buffer, mimetype) => {
    const signatures = MAGIC_BYTES[mimetype];
    if (!signatures)
        return false;
    return signatures.some(sig => buffer.slice(0, sig.length).equals(sig));
};
// Use memory storage so we can inspect magic bytes BEFORE writing to disk
const fileFilter = (_req, file, cb) => {
    const fileName = (file.originalname || '').toLowerCase();
    const allowedExts = ['jpg', 'jpeg', 'png', 'webp'];
    const dangerousExts = ['svg', 'html', 'htm', 'php', 'js', 'exe', 'sh', 'bat', 'pdf', 'asp', 'aspx', 'jsp'];
    const parts = fileName.split('.').filter(Boolean);
    const lastExt = parts.pop() || '';
    // 1. Check final extension
    if (!allowedExts.includes(lastExt)) {
        return cb(new AppError('Invalid logo file. Only JPG, JPEG, PNG, and WEBP image files are allowed for Logo upload.', 400));
    }
    // 2. Double extension check (reject if any prior extension part is a dangerous script/document)
    const hasDangerousPrefix = parts.some(part => dangerousExts.includes(part));
    if (hasDangerousPrefix) {
        return cb(new AppError('Invalid file format. Script/document double extensions (.svg, .pdf, .php, etc.) are strictly prohibited.', 400));
    }
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype) && file.mimetype) {
        return cb(new AppError(`Invalid file type "${file.mimetype}". Only JPEG, PNG, and WebP image files are allowed for Logo upload.`, 400));
    }
    cb(null, true);
};
const storage = multer.memoryStorage();
// Intermediate multer instance (memory storage for magic byte check)
const memUpload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 2 * 1024 * 1024 } // 2MB — WASA requirement
});
/**
 * Express middleware that:
 *  1. Accepts the file into memory
 *  2. Validates magic bytes
 *  3. Writes to disk with a cryptographically random name
 *
 * Usage: uploadLogo.single('logo')
 */
export const uploadLogo = {
    single: (fieldName) => {
        return (req, res, next) => {
            memUpload.single(fieldName)(req, res, async (err) => {
                if (err) {
                    if (err.code === 'LIMIT_FILE_SIZE') {
                        return next(new AppError('File is too large. Maximum allowed size is 2MB.', 400));
                    }
                    return next(err);
                }
                if (!req.file)
                    return next(); // No file uploaded — optional field
                // Magic byte validation
                const isValidImage = validateMagicBytes(req.file.buffer, req.file.mimetype);
                if (!isValidImage) {
                    return next(new AppError('File content does not match declared JPEG, PNG, or WebP image type. Upload rejected.', 400));
                }
                // Generate secure random filename — no user input involved
                const ext = (req.file.mimetype === 'image/png') ? '.png'
                    : (req.file.mimetype === 'image/webp') ? '.webp'
                        : '.jpg';
                const secureFilename = `logo-${crypto.randomUUID()}${ext}`;
                const destPath = path.join(uploadDir, secureFilename);
                // Write validated file to disk
                fs.writeFileSync(destPath, req.file.buffer);
                // Patch req.file to match what downstream controllers expect
                req.file.filename = secureFilename;
                req.file.path = destPath;
                next();
            });
        };
    }
};
/**
 * Validates a base64 file data URL to ensure it is strictly a PDF or JPEG/PNG file,
 * has valid magic bytes, and does not exceed the size limit.
 */
export const validateBase64File = (fileData) => {
    if (!fileData)
        return;
    // Check if it's a data URL
    const match = fileData.match(/^data:([^;]+);base64,(.*)$/);
    if (!match) {
        throw new AppError('Invalid document format. Must be a valid file data URL.', 400);
    }
    const mimetype = match[1];
    const base64Payload = match[2];
    const ALLOWED = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!ALLOWED.includes(mimetype)) {
        throw new AppError('Only PDF, JPEG, PNG, and WebP files are allowed.', 400);
    }
    const buffer = Buffer.from(base64Payload, 'base64');
    // Size check (max 2MB)
    if (buffer.length > 2 * 1024 * 1024) {
        throw new AppError('File size exceeds the 2MB limit.', 400);
    }
    // Magic bytes check
    let valid = false;
    if (mimetype === 'application/pdf') {
        // %PDF
        valid = buffer.slice(0, 4).equals(Buffer.from([0x25, 0x50, 0x44, 0x46]));
    }
    else if (mimetype === 'image/png') {
        valid = buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    }
    else if (mimetype === 'image/webp') {
        valid = buffer.slice(0, 4).equals(Buffer.from([0x52, 0x49, 0x46, 0x46]));
    }
    else {
        // JPEG starts with 0xff, 0xd8, 0xff
        valid = buffer.slice(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
    }
    if (!valid) {
        throw new AppError('File content mismatch. The uploaded file content is invalid.', 400);
    }
};
