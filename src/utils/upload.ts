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
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

// Magic byte signatures for image validation
// These are the actual binary signatures found at the start of valid image files
const MAGIC_BYTES: Record<string, Buffer[]> = {
    'image/jpeg': [Buffer.from([0xff, 0xd8, 0xff])],
    'image/png':  [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    'image/webp': [Buffer.from('RIFF'), Buffer.from('WEBP')], // RIFF????WEBP
};

/**
 * Validates actual file magic bytes against declared MIME type.
 * Prevents attacks where a malicious file (e.g., PHP script) is renamed to .jpg
 * and uploaded with mimetype: image/jpeg — the content itself is checked.
 */
const validateMagicBytes = (buffer: Buffer, mimetype: string): boolean => {
    const signatures = MAGIC_BYTES[mimetype];
    if (!signatures) return false;

    if (mimetype === 'image/webp') {
        // WEBP: starts with RIFF, bytes 8-11 are WEBP
        return (
            buffer.slice(0, 4).equals(Buffer.from('RIFF')) &&
            buffer.slice(8, 12).equals(Buffer.from('WEBP'))
        );
    }

    return signatures.some(sig => buffer.slice(0, sig.length).equals(sig));
};

// Use memory storage so we can inspect magic bytes BEFORE writing to disk
const storage = multer.memoryStorage();

const fileFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        return cb(new AppError(
            `Invalid file type "${file.mimetype}". Only JPEG, PNG, and WebP images are allowed.`,
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
                        'File content does not match the declared image type. Upload rejected.',
                        400
                    ));
                }

                // Generate secure random filename — no user input involved
                const ext = req.file.mimetype === 'image/jpeg' ? '.jpg'
                         : req.file.mimetype === 'image/png'  ? '.png'
                         : req.file.mimetype === 'image/webp' ? '.webp'
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
