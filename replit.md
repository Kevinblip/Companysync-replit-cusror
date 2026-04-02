# replit.md

## Overview
This project is a comprehensive SaaS platform designed for roofing contractors, offering a suite of tools including CRM, estimating, invoicing, crew management, AI-powered damage inspection (CrewCam), calendar synchronization, workflow automation, and accounting features. The platform aims to streamline operations and enhance efficiency for roofing businesses, with the ambition of becoming a leading solution in the industry. It leverages a local PostgreSQL database for all data operations and integrates with Base44 BaaS for authentication and serverless functions.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
The frontend is a React single-page application built with Vite, utilizing `shadcn/ui` (New York style) and Tailwind CSS. State management is handled by TanStack React Query, and forms by React Hook Form. It features custom components for AI interactions (image annotation, voice) and is optimized for mobile UX with PWA support.

### Backend
The backend uses a hybrid architecture, routing all data operations through a local PostgreSQL database via a universal entity API. It intercepts `base44.entities.*` calls to `/api/local/entity/{EntityType}` endpoints. Multi-tenancy is enforced with `company_id`. Authentication supports Replit OIDC and email/password, both using Passport. Platform admin access is database-driven.

### Core Integrations (Local)
A Vite plugin (`vite-integrations-plugin.js`) provides local replacements for Base44's Core integration APIs:
- **InvokeLLM**: Routes to Google Gemini API.
- **UploadFile**: Uses local file storage (`public/uploads/`).
- **SendEmail**: Routes to Resend API.

### Local PostgreSQL (Primary Data Layer)
All primary data resides in a local PostgreSQL database, comprising 13 dedicated tables and a `generic_entities` table for over 80 other entity types using JSONB. It includes an SDK name mapping and a filter translation layer for MongoDB-style operators. Call routing employs a 3-tier lookup: in-memory cache, local PostgreSQL, and Base44 API fallback.

### Serverless Functions
Serverless functions, written in TypeScript and executed on Deno, are located in `functions/`. They support authentication, cron jobs, and service role operations, covering functionalities like AI Analysis, Calendar Sync, Telephony, Workflow Automation, and Storm Tracking. Local handlers and a cron scheduler (`vite-cron-plugin.js`) manage these functions.

### AI Capabilities
- **CrewCam AI Photo Analysis**: Utilizes Gemini 2.5 Flash for material identification and damage detection.
- **AI Roof Measurement**: Employs Google Solar API with geometry-based roof type classification and calculates linear feet and waste factor.
- **AI Estimator Calibration Memory**: Compares user-uploaded reports (EagleView/Hover/GAF) against AI estimates, saving correction ratios as `AIMemory` entities to improve future estimates.
- **Report Extraction**: Uses enhanced GPT-4o/Gemini prompts for extracting specific materials from various reports.
- **Satellite Vision Analysis**: Leverages Gemini vision prompts to detect roof type, complexity, linear features, structural features, and building footprint ratios.
- **AI Voice Bridge (Sarah/Lexi)**: Provides AI-powered voice interaction for call agents and CRM tools via Gemini 2.5 speech-to-speech. Lexi supports full CRUD operations on key entities (Leads, Customers, Estimates, Invoices, Tasks, Projects, Notes) and other actions, with certain restrictions on sensitive data.

### Security Model
- **Role-Based Access Control**: Non-admin staff can only view their own leads and customers. Global view permissions (`view_global`) are explicitly managed and distinct from basic view permissions.
- **Admin Access**: Determined by company ownership or explicit administrator flags, enforced via a startup fix for specific users.
- **Data Filtering**: Pages displaying sensitive data (e.g., Leads, Customers) use `useRoleBasedData` for dynamic, role-based filtering.

## External Dependencies

### Core Platform
- **Base44 BaaS**: Authentication and serverless functions.

### AI / ML Services
- **Google Gemini API**: AI image analysis, speech-to-speech, and general AI capabilities.
- **Poe API**: Advanced multi-photo damage analysis.
- **Google Solar API**: Satellite roof measurements and building insights.
- **Google Maps / Geocoding API**: Address geocoding and mapping.

### Communication
- **Twilio**: SMS, voice calls, and AI call agents.
- **Resend API**: Email sending.
- **Google Calendar API**: OAuth-based calendar synchronization.

### Payments
- **Stripe**: Payment processing.

### BYOK (Bring Your Own Key) Billing Engine
- **BYOK**: Allows paid subscribers to use their own API keys for Gemini, Twilio, and SMTP/Resend.
- **Encryption**: AES-256-GCM for API keys.
- **Metered Billing**: Tracks and bills AI usage for paid subscribers via Stripe.

### CRM Integration
- **GoHighLevel (GHL)**: Lead synchronization (bulk import, push leads, scheduled sync).

### Public Estimate PDF
- **jsPDF**: Server-side PDF generation for public estimate links.

### Supply Chain
- **ABC Supply**: Material ordering integration.

### Direct Bid Mailer Automation
- **RentCast**: Homeowner lookup.
- **Marcus AI**: Letter generation (Gemini).
- **PostGrid**: Physical mailer fulfillment.