# Security Testing and QA Verification Guide

This document contains Postman/API test steps, manual QA checklists, edge cases, and validation steps to confirm that all 8 WASA security vulnerabilities are fully resolved.

---

## 1. Business Logic Flaw (Module Access)
### Manual QA Checklist
- [ ] Login as Super Admin and navigate to Clinic Management.
- [ ] Enable all modules for a clinic.
- [ ] Login as a Doctor/Receptionist in that clinic in Browser A (Active Session). Verify access to the modules (e.g. Pharmacy/Lab).
- [ ] In Browser B, as Super Admin, disable the Pharmacy module for that clinic.
- [ ] Go back to Browser A and attempt any Pharmacy module API request or action.
- [ ] Verify that access is immediately revoked with a `403 Forbidden` response.

### API Test Steps & curl
1. **Get active session token** for a Clinic Staff.
2. **Call Pharmacy Endpoint**:
   ```bash
   curl -X GET http://localhost:5000/api/pharmacy/medicines \
     -H "Authorization: Bearer <STAFF_ACCESS_TOKEN>" \
     -H "x-clinic-id: <CLINIC_ID>"
   ```
   *Expected Response:* `200 OK` (if Pharmacy module is enabled).
3. **Disable Pharmacy Module** (via Super Admin update modules endpoint):
   ```bash
   curl -X PATCH http://localhost:5000/api/super/clinics/<CLINIC_ID>/modules \
     -H "Authorization: Bearer <SUPER_ADMIN_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"pharmacy": false, "radiology": true, "laboratory": true, "billing": true}'
   ```
4. **Call Pharmacy Endpoint again**:
   ```bash
   curl -X GET http://localhost:5000/api/pharmacy/medicines \
     -H "Authorization: Bearer <STAFF_ACCESS_TOKEN>" \
     -H "x-clinic-id: <CLINIC_ID>"
   ```
   *Expected Response:* `403 Forbidden` with message: `"The Pharmacy module is not enabled for this clinic."`

---

## 2. Concurrent Login (Single-Session - First Login Wins)
### Manual QA Checklist
- [ ] Open Browser A (Chrome) and login as `admin@gmail.com`.
- [ ] Verify login is successful and keep Browser A open.
- [ ] Open Browser B (Firefox / Incognito) and attempt to login as `admin@gmail.com`.
- [ ] Verify Browser B login fails with a `409 Conflict` error stating: `"This account is already logged in from another device. Please log out from the existing session first."`
- [ ] In Browser A, click "Logout" (or call `/api/auth/logout` API).
- [ ] Try logging in again in Browser B. Verify that login now succeeds.

### API Test Steps & curl
1. **Login User on Device A**:
   ```bash
   curl -X POST http://localhost:5000/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email": "admin@gmail.com", "password": "correct_password"}'
   ```
   *Expected Response:* `200 OK` (with verification code sent/required, or success if 2FA token present).
2. **Verify OTP / Complete Login** on Device A to lock the session:
   ```bash
   curl -X POST http://localhost:5000/api/auth/verify-otp \
     -H "Content-Type: application/json" \
     -d '{"email": "admin@gmail.com", "otp": "123456"}'
   ```
   *Expected Response:* `200 OK` containing `"token"` and `"refreshToken"`.
3. **Login User on Device B** (simulate concurrent login):
   ```bash
   curl -X POST http://localhost:5000/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email": "admin@gmail.com", "password": "correct_password"}'
   ```
   *Expected Response:* `409 Conflict` with JSON error payload:
   ```json
   {
     "success": false,
     "status": "fail",
     "message": "This account is already logged in from another device. Please log out from the existing session first."
   }
   ```
4. **Logout User on Device A**:
   ```bash
   curl -X POST http://localhost:5000/api/auth/logout \
     -H "Authorization: Bearer <DEVICE_A_ACCESS_TOKEN>"
   ```
   *Expected Response:* `200 OK` `"Logged out successfully."`
5. **Login User on Device B again**:
   *Expected Response:* `200 OK` (Successful login page, code dispatched).

---

## 3. Improper Error Handling (Production Hardening)
### Manual QA Checklist
- [ ] Stop local development. Run backend in production mode (`NODE_ENV=production npm start`).
- [ ] Trigger an error (e.g. request a non-existent database entity or supply a broken JSON body like `{"email": "invalid"`).
- [ ] Inspect the API response.
- [ ] Verify that no internal file path, database query structure, table name, or raw framework stack trace is returned.
- [ ] Verify the response message is a generic error description or standard 500 status payload.

### API Test Steps & curl
1. Set `NODE_ENV=production` on the server and start the app.
2. Send a request that triggers a database query crash (e.g., query clinic details with an invalid ID format/out-of-bounds integer if not validated upstream, or inject malformed data).
   ```bash
   curl -X GET http://localhost:5000/api/super/clinics/abc \
     -H "Authorization: Bearer <SUPER_ADMIN_TOKEN>"
   ```
   *Expected Response (Production):*
   ```json
   {
     "success": false,
     "status": "error",
     "message": "Internal Server Error"
   }
   ```
   *Verify server logs:* The full error and stack trace must be printed *only* on the terminal console logs, never sent to the client.

---

## 4. Session Timeout (15-Minute Expiry & Refresh)
### Manual QA Checklist
- [ ] Log in to the application and obtain an access token.
- [ ] Wait for 15 minutes of inactivity (or mock JWT expiry locally by setting `1m` in `auth.service.ts` temporary token sign helper).
- [ ] Perform any protected API request (e.g., fetch profile or search patients).
- [ ] Verify that the request fails with a `401 Unauthorized` and redirect to Login screen.
- [ ] Verify that the frontend has refresh token client logic to hit `/api/auth/refresh-token` periodically when active to get a new access token without logging out.

### API Test Steps & curl
1. **Refresh Token Request**:
   ```bash
   curl -X POST http://localhost:5000/api/auth/refresh-token \
     -H "Content-Type: application/json" \
     -d '{"refreshToken": "<REFRESH_TOKEN>"}'
   ```
   *Expected Response:* `200 OK` containing a new, valid access token:
   ```json
   {
     "success": true,
     "data": {
       "token": "<NEW_ACCESS_TOKEN>"
     }
   }
   ```

---

## 5. Malicious File Upload (Multer Magic Bytes Verification)
### Manual QA Checklist
- [ ] Navigate to Clinic Settings/Branding where clinic logo is uploaded.
- [ ] Prepare a text file containing HTML/JavaScript code (e.g. `test.html` or `exploit.php`).
- [ ] Rename the file to `spoofed.jpg`.
- [ ] Attempt to upload `spoofed.jpg` as the clinic logo.
- [ ] Verify that the server rejects the upload with `400 Bad Request` saying `"File content does not match the declared image type"`.
- [ ] Attempt to upload an image larger than 2MB. Verify it gets rejected with `"File is too large"`.
- [ ] Upload a genuine JPEG or PNG image under 2MB. Verify upload succeeds.

### API Test Steps & curl
1. **Spoofed File Upload Check**:
   ```bash
   curl -X POST http://localhost:5000/api/super/clinics \
     -H "Authorization: Bearer <SUPER_ADMIN_TOKEN>" \
     -F "name=Test Clinic" \
     -F "subdomain=test" \
     -F "logo=@exploit.php.jpg"
   ```
   *Expected Response:* `400 Bad Request` with message: `"File content does not match the declared image type. Upload rejected."`

---

## 6. Version Disclosure
### Manual QA Checklist
- [ ] Fire any HTTP request to the backend.
- [ ] Inspect the Response Headers.
- [ ] Verify that `X-Powered-By` header is absent.
- [ ] Verify that the `Server` header does not disclose framework/Node version.

### API Test Steps & curl
```bash
curl -I http://localhost:5000/health
```
*Expected Headers:*
- `x-powered-by` header must not exist.
- `server` header must be omitted or sanitized (e.g. standard cloud proxy headers only).

---

## 7. OTP Disclosure (🚨 Critical 2FA Bypass Fix)
### Manual QA Checklist
- [ ] Open the application Login screen.
- [ ] Enter a valid email and password for a Staff user. Click "Submit".
- [ ] Open the browser network inspector tab (F12 Developer Tools).
- [ ] Inspect the response payload of the POST request to `/api/auth/login`.
- [ ] Verify that the field `"devOtp"` is **NOT** present in the JSON body.
- [ ] Check email inbox for the OTP. Enter the code to verify.

### API Test Steps & curl
1. **Login Trigger**:
   ```bash
   curl -X POST http://localhost:5000/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email": "doctor@gmail.com", "password": "password123"}'
   ```
   *Expected Response JSON:*
   ```json
   {
     "success": true,
     "message": "Verification code sent to email",
     "data": {
       "success": true,
       "otpRequired": true,
       "user": {
         "id": 12,
         "email": "doctor@gmail.com",
         ...
       },
       "token": null
     }
   }
   ```
   *Crucial Check:* The key `devOtp` is entirely gone from the payload. The user must verify using the OTP sent to their email.
