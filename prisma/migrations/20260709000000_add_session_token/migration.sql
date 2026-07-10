-- WASA Security Fix #2: Single-Session Enforcement
-- Adds sessionToken column to the user table.
-- Logic: If sessionToken IS NOT NULL → user is already logged in → block new login.
-- On logout → sessionToken is set to NULL → account becomes available again.

ALTER TABLE `user` ADD COLUMN `sessionToken` VARCHAR(191) NULL;
