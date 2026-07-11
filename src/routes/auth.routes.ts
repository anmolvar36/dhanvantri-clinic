import { Router } from 'express';
import * as authController from '../controllers/auth.controller.js';
import { protect } from '../middlewares/auth.js';

const router = Router();

// Public routes
router.post('/login', authController.login);
router.post('/verify-otp', authController.verifyOTP);
router.post('/resend-otp', authController.resendOTP);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);
router.get('/clear-live-sessions', authController.clearLiveSessions);
router.get('/delete-mukul', authController.deleteMukulData);

// WASA Fix #4: Refresh token is PUBLIC (takes refreshToken in body, no access token needed)
router.post('/refresh-token', authController.refreshToken);

// Protected routes
router.get('/clinics/my', protect, authController.getMyClinics);
router.post('/select-clinic', protect, authController.selectClinic);
router.post('/change-password', protect, authController.changePassword);

// WASA Fix #2: Logout — requires valid token, clears session
router.post('/logout', protect, authController.logout);

export default router;
