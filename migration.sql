-- ==========================================================
-- AZAM SERVICE DESK - FULL DATABASE SCHEMA REBUILD (SUPABASE)
-- Instructions: 
-- 1. Log in to your Supabase Dashboard.
-- 2. Select your project and click on "SQL Editor" in the left-hand menu.
-- 3. Click "New Query" & paste this entire script.
-- 4. Click "Run" on the bottom-right to execute.
-- ==========================================================

-- Enable UUID extension if not present
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Safely drop old conflicting, incomplete, or mismatched tables
DROP TABLE IF EXISTS "users" CASCADE;
DROP TABLE IF EXISTS "jobs" CASCADE;
DROP TABLE IF EXISTS "activity" CASCADE;
DROP TABLE IF EXISTS "otc_jobs" CASCADE;

-- 1. Create 'users' table with fields matching the TypeScript User type exactly
CREATE TABLE "users" (
  "id" VARCHAR(255) PRIMARY KEY,
  "name" VARCHAR(255) NOT NULL,
  "username" VARCHAR(255) UNIQUE NOT NULL,
  "password" VARCHAR(255) NOT NULL,
  "role" VARCHAR(50) NOT NULL CHECK ("role" IN ('admin', 'technician', 'management', 'technical_analyst', 'otc_manager', 'otc_user')),
  "region" VARCHAR(100),
  "branch" VARCHAR(100),
  "managementType" VARCHAR(100),
  "createdAt" VARCHAR(255) NOT NULL
);

-- 2. Create 'jobs' table with technician data fields in correct camelCase
CREATE TABLE "jobs" (
  "id" VARCHAR(255) PRIMARY KEY,
  "technicianId" VARCHAR(255) NOT NULL,
  "technicianName" VARCHAR(255) NOT NULL,
  "region" VARCHAR(100) NOT NULL,
  "branch" VARCHAR(100) NOT NULL,
  "date" DATE NOT NULL,
  "submittedAt" VARCHAR(255) NOT NULL,
  "status" VARCHAR(50) DEFAULT 'submitted' NOT NULL,
  "customerName" VARCHAR(255) NOT NULL,
  "phone" VARCHAR(100),
  "cardNumber" VARCHAR(100) NOT NULL,
  "faultType" VARCHAR(100) NOT NULL,
  "modelNumber" VARCHAR(100) NOT NULL,
  "troubleshootingDescription" TEXT,
  "result" VARCHAR(50) NOT NULL,
  "replacement" VARCHAR(50) NOT NULL,
  "replacementReason" VARCHAR(255),
  "isFieldJob" BOOLEAN DEFAULT FALSE,
  "agentName" VARCHAR(255)
);

-- 3. Create 'activity' table for administrative audit logging
CREATE TABLE "activity" (
  "id" VARCHAR(255) PRIMARY KEY,
  "userId" VARCHAR(255) NOT NULL,
  "userName" VARCHAR(255) NOT NULL,
  "userRole" VARCHAR(100) NOT NULL,
  "action" VARCHAR(100) NOT NULL,
  "detail" TEXT NOT NULL,
  "timestamp" VARCHAR(255) NOT NULL
);

-- 4. Create 'otc_jobs' table for Over-The-Counter support tracking
CREATE TABLE "otc_jobs" (
  "id" VARCHAR(255) PRIMARY KEY,
  "name" VARCHAR(255) NOT NULL,
  "phone_number" VARCHAR(100) NOT NULL,
  "card_number" VARCHAR(100) NOT NULL,
  "problem" TEXT NOT NULL,
  "status" VARCHAR(50) DEFAULT 'pending' NOT NULL CHECK ("status" IN ('pending', 'done')),
  "source" VARCHAR(50) DEFAULT 'OTC' NOT NULL,
  "created_at" VARCHAR(255) NOT NULL,
  "repaired_by" VARCHAR(255) DEFAULT NULL,
  "repaired_at" VARCHAR(255) DEFAULT NULL
);

-- Create highly optimized search indexing for automatic OTC matching logic
CREATE INDEX IF NOT EXISTS idx_otc_jobs_matching ON "otc_jobs" ("card_number", "phone_number", "status");
CREATE INDEX IF NOT EXISTS idx_jobs_matching ON "jobs" ("cardNumber", "phone");

-- Add 'otc_jobs' to Supabase Realtime publication (if publication exists)
-- This powers the real-time ticket sync dashboards instantly when a database insertion occurs
BEGIN;
  DO $$
  BEGIN
    IF EXISTS (
      SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE "otc_jobs";
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE 'Skipping publication setup - will execute automatically in default Supabase environments';
  END;
  $$;
COMMIT;
