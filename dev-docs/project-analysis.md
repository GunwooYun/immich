# Immich Project Technical & Architectural Analysis Report

## 1. Executive Summary

**Immich** is a high-performance, open-source, self-hosted photo and video management solution designed as a privacy-focused alternative to commercial cloud photo services (such as Google Photos or Apple Photos). 

The repository is structured as a monorepo containing:
- A **NestJS Backend Server** handling REST APIs, background job processing, media transcoding, metadata extraction, and database persistence.
- A **SvelteKit Web Frontend** delivering a responsive web interface with virtual scrolling, map views, album management, and administrative tools.
- A **Flutter Mobile Application** providing cross-platform iOS/Android apps with background auto-backup capabilities and local caching via SQLite/Drift.
- A **Python Machine Learning Microservice** performing smart search (CLIP embeddings), facial recognition (InsightFace), object detection, and OCR.
- **Shared Monorepo Packages** containing generated OpenAPI TypeScript SDKs, CLI tools, and plugin interfaces.

---

## 2. Monorepo Structure & Technology Stack

| Directory | Component | Primary Technologies | Key Responsibilities |
| :--- | :--- | :--- | :--- |
| `server/` | Backend API & Worker Server | Node.js, NestJS, TypeScript, PostgreSQL, Kysely, Redis, BullMQ, Sharp, FFmpeg, ExifTool | Core API, asset storage management, job queues, metadata parsing, user & auth management |
| `web/` | Web Frontend | Svelte / SvelteKit, TypeScript, Vite, Tailwind CSS | Web application UI, photo/video gallery, administration panel, shared links, settings |
| `mobile/` | Mobile Application | Flutter, Dart, Drift (SQLite), OpenAPI Generated Client, Pigeon | iOS/Android native app, automatic background media upload, local metadata cache |
| `machine-learning/` | ML Microservice | Python 3, PyTorch, ONNX Runtime, FastAPI, OpenCLIP, InsightFace | Facial recognition, smart semantic search embeddings, image classification, OCR |
| `packages/` | Core Utilities & SDKs | TypeScript, Node.js | `@immich/sdk` (OpenAPI SDK), `@immich/cli` (command-line backup), `@immich/plugin-sdk` |
| `open-api/` | API Specification | OpenAPI v3 (JSON/YAML) | Single source of truth for REST endpoints; used to auto-generate client SDKs |
| `docker/` & `deployment/` | Containerization & Infra | Docker, Docker Compose, Helm | Standardized deployment recipes for production and local development |

---

## 3. Core Architecture & Subsystem Analysis

```
+-----------------------------------------------------------------------------------+
|                                 CLIENT APPLICATIONS                               |
|   +-----------------------+   +----------------------+   +--------------------+   |
|   |  SvelteKit Web Client |   | Mobile (Flutter/Dart)|   | Immich CLI Client  |   |
|   +-----------+-----------+   +----------+-----------+   +---------+----------+   |
+---------------|--------------------------|-------------------------|--------------+
                |                          |                         |
                +--------------------------+-------------------------+
                                           |
                                   REST / WebSocket
                                           v
+-----------------------------------------------------------------------------------+
|                                   SERVER LAYER                                    |
|   +---------------------------------------------------------------------------+   |
|   | NestJS Controllers (Asset, Auth, User, Album, SystemConfig, Job, etc.)    |   |
|   +------------------------------------+--------------------------------------+   |
|                                        |                                          |
|            +---------------------------+---------------------------+              |
|            v                                                       v              |
|   +-------------------+                                   +-------------------+   |
|   | Kysely ORM / Query|                                   |  BullMQ Workers   |   |
|   +---------+---------+                                   +---------+---------+   |
+-------------|-------------------------------------------------------|-------------+
              |                                                       |
              v                                                       v
+---------------------------+   +---------------------+   +-------------------------+
|     PostgreSQL DB         |   |    Redis Queue      |   |  Python ML Service      |
| (Assets, Users, EXIF, etc)|   |  (Job Coordination) |   | (CLIP, Face Recognition)|
+---------------------------+   +---------------------+   +-------------------------+
```

### 3.1 Server Infrastructure (`server/`)
- **Framework & Routing**: NestJS with modular architecture (`app.module.ts`, domain controllers, services, repositories).
- **Database Layer**: PostgreSQL managed via **Kysely** query builder and SQL migrations using `@immich/sql-tools`.
- **Job Processing & Asynchronous Queues**: **BullMQ** over **Redis** manages asynchronous task execution (thumbnail generation, video transcoding, ML processing, sidecar indexing, smart search indexing).
- **Media Pipeline**: 
  - Image processing powered by `sharp` and `thumbhash`.
  - Video processing & HLS streaming via `fluent-ffmpeg`.
  - Metadata parsing (EXIF/GPS/Camera info) using `exiftool-vendored`.
- **Storage Management**: Structured storage paths configured via storage templates (`storage-template.service.ts`). Physical files reside in configured user upload directories.

### 3.2 Machine Learning Microservice (`machine-learning/`)
- Independent Python service exposing a FastAPI interface.
- Executes ML pipelines for:
  - **Smart Search**: Semantic image & text matching via OpenCLIP / CLIP models.
  - **Facial Recognition**: Face detection and recognition using InsightFace embeddings.
  - **OCR & Tagging**: Text extraction from images.
- Communicates asynchronously with NestJS workers via HTTP endpoints.

### 3.3 Mobile & Web Clients (`mobile/`, `web/`)
- **Mobile**: Flutter-based app using `Drift` for local SQLite database management, caching asset metadata offline, and scheduling background sync tasks.
- **Web**: Lightweight SvelteKit SPA/SSR application interacting with the backend via OpenAPI-generated client SDKs.

---

## 4. Key Data Flow: Asset Upload & Storage Pipeline

1. **Client Request**: Client (Web, Mobile, or CLI) sends a multipart/form-data request or chunked upload to `AssetController` (`server/src/controllers/asset.controller.ts`).
2. **Deduplication Check**: Checksum (SHA-1 / MD5) verification prevents duplicating existing assets.
3. **Storage Allocation**: `StorageService` places the raw file into the target upload folder (structured by user ID and storage template rules).
4. **Database Record Creation**: An `Asset` entity is saved in PostgreSQL with `OriginalPath`, `Checksum`, `OwnerId`, `CreatedAt`, etc.
5. **Background Task Dispatch**:
   - `THUMBNAIL_GENERATION` queue generates web previews and micro thumbnails (`thumbhash`).
   - `METADATA_EXTRACTION` queue extracts EXIF/GPS info using `exiftool`.
   - `VIDEO_TRANSCODING` queue converts videos to web-compatible formats (HLS/MP4) if required.
   - `MACHINE_LEARNING` queue dispatches asset data to Python ML for face detection and CLIP embeddings.

---

## 5. Blueprint for Google Drive Export / Integration Feature

The user request specifies extending Immich with **Google API integration to upload photos/videos to a Google Drive folder**.

### Recommended Architecture & Implementation Strategy

```
+---------------------------------------------------------------------------------+
|                              IMMICH BACKEND SERVER                              |
|                                                                                 |
|  +------------------------+      +---------------------+      +--------------+  |
|  | Google Auth Service    | ---> | OAuth Token Storage | ---> | User Config  |  |
|  | (OAuth2 authorization) |      | (Encrypted via Kysely)     | (Target Dir) |  |
|  +------------------------+      +---------------------+      +--------------+  |
|                                                                                 |
|  +---------------------------------------------------------------------------+  |
|  | Google Drive Export Worker (BullMQ Job Queue)                             |  |
|  |   1. Bound via server/src/workers/microservices.ts                         |  |
|  |   2. Upload file via Google Drive API v3 (Resumable upload session)        |  |
|  |   3. Log sync status & handle exponential backoff rate limits             |  |
|  +---------------------------------------------------------------------------+  |
+----------------------------------------|----------------------------------------+
                                         |
                                         v
                            +--------------------------+
                            |     Google Drive API     |
                            |   (googleapis / REST v3) |
                            +--------------------------+
```

### Proposed Modules & Files to Implement/Modify:

1. **OAuth2 Authentication & Database Persistence**:
   - **Schema Migration**: Generate a new Kysely migration using `@immich/sql-tools` (e.g., `pnpm run migrations:generate`) to add `google_drive_refresh_token` and `google_drive_folder_id` to the `users` table or a new `user_integrations` table.
   - **Repositories**: Update `server/src/repositories/user.repository.ts` to handle these fields.
   - **Controllers**: Add endpoints in a new `server/src/controllers/google-drive.controller.ts` to handle the Google OAuth callback and token storage.

2. **Google Drive Sync Service**:
   - Create `GoogleDriveService` in `server/src/services/google-drive.service.ts` to handle the Google Drive API v3 interactions (including Resumable Uploads for large files).

3. **Background Job Queue (BullMQ)**:
   - **Enums**: Modify `server/src/enum.ts` to add `GoogleDrive` to the `QueueName` enum and `GoogleDriveUpload` to the `JobName` enum.
   - **Service**: Update `server/src/services/job.service.ts` and `server/src/services/queue.service.ts` to handle the new `GoogleDrive` queue.
   - **Workers**: Create a processor (e.g., `server/src/workers/google-drive.processor.ts`) and ensure it's registered in the microservices bootstrap (`server/src/workers/microservices.ts`).

4. **User Options & Web/Mobile UI**:
   - **Web (SvelteKit)**: Update user settings pages in `web/src/lib/components/` to add a "Connect to Google Drive" button and folder configuration.
   - **Mobile (Flutter)**: Update the Dart models and UI in `mobile/lib/` to reflect the new sync options.

---

## 6. Directory Structure Created

As requested, this analysis report is saved at:
- `dev-docs/project-analysis.md`
