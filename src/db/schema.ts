/**
 * @file schema.ts
 * @description Database schema definitions and types for Azam TV Service Desk.
 * This establishes the complete Postgres / Supabase schema blueprint ensuring
 * all data tracking (users, jobs, activity, otc_jobs) is backed by a relational database.
 */

// 1. Database Roles & Option Enums
export enum UserRole {
  ADMIN = "admin",
  TECHNICIAN = "technician",
  MANAGEMENT = "management",
  TECHNICAL_ANALYST = "technical_analyst",
  OTC_MANAGER = "otc_manager",
  OTC_USER = "otc_user"
}

export enum JobStatus {
  PENDING = "pending",
  DONE = "done",
  SUBMITTED = "submitted"
}

// 2. TypeScript Interfaces for Type-Safety and DB Mapping

export interface DBUser {
  id: string; // uuid or custom string
  name: string;
  username: string;
  password?: string; // encrypted or hashed password
  role: UserRole | string;
  region: string;
  branch?: string;
  management_type?: string; // Analyst, Logistics, Technical Manager, Executive
  created_at: string;
}

export interface DBJob {
  id: string;
  technician_id: string;
  technician_name: string;
  region: string;
  branch: string;
  date: string; // YYYY-MM-DD
  submitted_at: string;
  status: string; // submitted / pending / done
  customer_name: string;
  phone: string;
  card_number: string;
  fault_type: string;
  model_number: string;
  troubleshoot_description: string;
  result: string; // OK / FAIL
  replacement: string; // Yes / No
  replacement_reason?: string;
  is_field_job?: boolean;
  agent_name?: string;
}

export interface DBActivity {
  id: string;
  user_id: string;
  user_name: string;
  user_role: string;
  action: "LOGIN" | "LOGOUT" | "SUBMIT_JOBS" | "ADD_USER" | "EDIT_USER" | "DELETE_USER" | "RESET_PW" | "ADD_REGION" | "EDIT_REGION" | "DELETE_REGION" | string;
  detail: string;
  timestamp: string;
}

export interface DBOtcJob {
  id: string; // uuid
  name: string;
  phone_number: string;
  card_number: string;
  problem: string;
  status: "pending" | "done" | string;
  source: "OTC" | string;
  created_at: string;
  repaired_by?: string | null; // Technician name who repaired it
  repaired_at?: string | null; // Timestamp when technician solved it
}

// 3. Raw SQL DDL Definitions for Supabase / PostgreSQL migrations
export const DATABASE_DDL = `
-- Enable UUID extension if not present
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Table: users
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  username VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'technician', 'management', 'technical_analyst', 'otc_manager', 'otc_user')),
  region VARCHAR(100),
  branch VARCHAR(100),
  management_type VARCHAR(100), -- Analyst, Logistics, Technical Manager, Executive
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Table: jobs (Technician and Field Job entries)
CREATE TABLE IF NOT EXISTS jobs (
  id VARCHAR(255) PRIMARY KEY,
  technician_id VARCHAR(255) NOT NULL,
  technician_name VARCHAR(255) NOT NULL,
  region VARCHAR(100) NOT NULL,
  branch VARCHAR(100) NOT NULL,
  date DATE NOT NULL,
  submitted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
  status VARCHAR(50) DEFAULT 'submitted' NOT NULL,
  customer_name VARCHAR(255) NOT NULL,
  phone VARCHAR(100),
  card_number VARCHAR(100) NOT NULL,
  fault_type VARCHAR(100) NOT NULL,
  model_number VARCHAR(100) NOT NULL,
  troubleshoot_description TEXT,
  result VARCHAR(50) NOT NULL, -- OK / FAIL
  replacement VARCHAR(50) NOT NULL, -- Yes / No
  replacement_reason VARCHAR(255),
  is_field_job BOOLEAN DEFAULT FALSE,
  agent_name VARCHAR(255)
);

-- Table: activity (Authentication & Action Logging)
CREATE TABLE IF NOT EXISTS activity (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id VARCHAR(255) NOT NULL,
  user_name VARCHAR(255) NOT NULL,
  user_role VARCHAR(100) NOT NULL,
  action VARCHAR(100) NOT NULL,
  detail TEXT NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Table: otc_jobs (Over-The-Counter customer service jobs)
CREATE TABLE IF NOT EXISTS otc_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  phone_number VARCHAR(100) NOT NULL,
  card_number VARCHAR(100) NOT NULL,
  problem TEXT NOT NULL,
  status VARCHAR(50) DEFAULT 'pending' NOT NULL CHECK (status IN ('pending', 'done')),
  source VARCHAR(50) DEFAULT 'OTC' NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
  repaired_by VARCHAR(255) DEFAULT NULL,
  repaired_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);

-- Create optimized index markers for matching technician jobs with OTC rows
CREATE INDEX IF NOT EXISTS idx_otc_jobs_matching ON otc_jobs (card_number, phone_number, status);
CREATE INDEX IF NOT EXISTS idx_jobs_matching ON jobs (card_number, phone);
`;
