import { Request, Response, NextFunction } from 'express';

const XOR_KEY = 42;

const encryptPayload = (text: string): string => {
    const buffer = Buffer.from(text, 'utf-8');
    for (let i = 0; i < buffer.length; i++) {
        buffer[i] = buffer[i] ^ XOR_KEY;
    }
    return buffer.toString('base64');
};

export const encryptResponseMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const isLocal = req.hostname === 'localhost' || req.hostname === '127.0.0.1';
    // Only bypass encryption if running locally AND NODE_ENV is not production
    if (isLocal && process.env.NODE_ENV !== 'production') {
        return next();
    }

    const originalJson = res.json;

    res.json = function (body: any): Response {
        // Exclude health check from encryption to keep uptime checkers happy
        if (req.path === '/health' || req.path === '/api/health') {
            return originalJson.call(this, body);
        }

        // Only encrypt if it's a successful response and has a body
        if (body && typeof body === 'object') {
            try {
                const stringified = JSON.stringify(body);
                const encrypted = encryptPayload(stringified);
                res.setHeader('X-Payload-Encrypted', 'true');
                res.setHeader('Access-Control-Expose-Headers', 'X-Payload-Encrypted');
                return originalJson.call(this, { encrypted });
            } catch (err) {
                console.error('[ENCRYPTION ERROR] Failed to encrypt payload:', err);
            }
        }
        return originalJson.call(this, body);
    };

    next();
};
