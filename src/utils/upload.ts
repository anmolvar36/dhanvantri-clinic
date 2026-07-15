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

// Allowed MIME types
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'application/pdf'];

// Magic byte signatures for JPEG/PDF validation
// These are the actual binary signatures found at the start of valid files
const MAGIC_BYTES: Record<string, Buffer[]> = {
    'image/jpeg': [Buffer.from([0xff, 0xd8, 0xff])],
    'image/jpg':  [Buffer.from([0xff, 0xd8, 0xff])],
    'application/pdf': [Buffer.from([0x25, 0x50, 0x44, 0x46])], // %PDF
};

/**
 * Validates actual file magic bytes against declared MIME type.
 * Prevents attacks where a malicious file is renamed and spoofed.
 */
const validateMagicBytes = (buffer: Buffer, mimetype: string): boolean => {
    const signatures = MAGIC_BYTES[mimetype];
    if (!signatures) return false;

    return signatures.some(sig => buffer.slice(0, sig.length).equals(sig));
};

// Use memory storage so we can inspect magic bytes BEFORE writing to disk
const storage = multer.memoryStorage();

const fileFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        return cb(new AppError(
            `Invalid file type "${file.mimetype}". Only PDF and JPEG/JPG files are allowed.`,
            400
        ) as any);
    }
    cb(null, true);
};

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
    single: (fieldName: string) => {
        return (req: any, res: any, next: any) => {
            memUpload.single(fieldName)(req, res, async (err: any) => {
                if (err) {
                    if (err.code === 'LIMIT_FILE_SIZE') {
                        return next(new AppError('File is too large. Maximum allowed size is 2MB.', 400));
                    }
                    return next(err);
                }

                if (!req.file) return next(); // No file uploaded — optional field

                // Magic byte validation
                const isValidImage = validateMagicBytes(req.file.buffer, req.file.mimetype);
                if (!isValidImage) {
                    return next(new AppError(
                        'File content does not match the declared PDF or JPEG type. Upload rejected.',
                        400
                    ));
                }

                // Generate secure random filename — no user input involved
                const ext = (req.file.mimetype === 'image/jpeg' || req.file.mimetype === 'image/jpg') ? '.jpg'
                         : req.file.mimetype === 'application/pdf' ? '.pdf'
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
 * Validates a base64 file data URL to ensure it is strictly a PDF or JPEG file,
 * has valid magic bytes, and does not exceed the size limit.
 */
export const validateBase64File = (fileData?: string) => {
    if (!fileData) return;

    // Check if it's a data URL
    const match = fileData.match(/^data:([^;]+);base64,(.*)$/);
    if (!match) {
        throw new AppError('Invalid document format. Must be a valid file data URL.', 400);
    }

    const mimetype = match[1];
    const base64Payload = match[2];

    const ALLOWED = ['application/pdf', 'image/jpeg', 'image/jpg'];
    if (!ALLOWED.includes(mimetype)) {
        throw new AppError('Only PDF and JPEG files are allowed.', 400);
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
    } else {
        // JPEG starts with 0xff, 0xd8, 0xff
        valid = buffer.slice(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
    }

    if (!valid) {
        throw new AppError('File content mismatch. The uploaded file is not a valid PDF or JPEG image.', 400);
    }
};
