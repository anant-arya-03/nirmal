# Nirmal · निर्मल

**Clean clothes. Clear process.**

A campus laundry and complaint management application with dedicated student and administrator workspaces.

## Project documentation

- [Project report](docs/PROJECT_REPORT.md): objectives, user roles, working process, technology, evaluation, and demonstration.
- [System design and working specification](docs/SYSTEM_DESIGN.md): architecture and database diagrams, data dictionary, API contracts, screen design, security, analytics, and operations.

## Run on Windows

Install **Node.js 24 or newer**, then double-click **START-NIRMAL.bat**. It installs locked dependencies when needed, builds the interface, seeds fictional records only when no default database file exists, and starts a server on the local computer.

Open **http://localhost:4173**.

| Workspace | Email | Local demo password |
| --- | --- | --- |
| Student | student@nirmal.example | Nirmal-demo-2026! |
| Administrator | admin@nirmal.example | Nirmal-demo-2026! |
| Second student, for privacy checks | meera@nirmal.example | Nirmal-demo-2026! |

These accounts and all seeded names are fictional. Use this launcher for local demonstration only. Do not deploy the demonstration database.

Terminal equivalent, from this directory:

```powershell
npm ci
npm run build
npm run demo
npm start
```

`npm run demo` refuses to seed a database that already contains accounts. Data survives restarts in `data/nirmal.sqlite`. Stop the server with Ctrl+C. After changing the interface, run `npm run build` again. `npm run dev` watches the server source; it does not rebuild the interface.

## What works

- Separate student and administrator accounts; registration, scrypt password hashing, eight-hour HttpOnly sessions, logout, password change, single-use password resets, role checks, and same-origin write protection.
- Student overview, assigned bags, collection booking, recorded bag handovers, laundry history, complaint submission, complaint timeline, notifications, profile, and settings.
- Administrative overview, complaint queue, bag assignment, sequential laundry operations, student activation/deactivation, worker creation/availability, reports, notifications, and service targets.
- Complaint lifecycle: Submitted → Under Review → Assigned → In Progress → Resolved → Closed. Each administrative update requires a note. Students can rate resolutions and reopen unresolved complaints for review.
- JPEG/PNG evidence up to 2 MiB and 12 megapixels, preview/removal, real upload progress, server-side pixel decoding, resizing to a maximum 1600-pixel edge, and metadata-free PNG storage. Evidence is accessible only to the owner and administrators.
- Server-side bag ownership and student record isolation. Integer versions reject stale updates. State changes, events, and notifications commit together.
- Reports calculated from stored data: registered students, active bags, pending/in-progress/resolved/overdue complaints, average resolution duration, satisfaction, worker activity, and daily trends. CSV export escapes formula-like cells.
- Original SVG mark, CSS laundry illustrations, self-hosted Inter, Lucide icons, Motion transitions, responsive layouts, dark mode, collapsible sidebar, Ctrl/Cmd+K page navigation, loading/empty states, toasts, and native confirmation dialogs.

Use separate browser profiles for simultaneous student and administrator sessions. The application does not use a role-switching demo button.

## Fresh installation without demo data

Run `npm ci` and `npm run build`, copy `.env.example` to `.env`, and configure the campus email domain and origin. Start with a new database path. Create the first administrator using a password supplied through the process environment:

```powershell
$securePassword = Read-Host 'New administrator password (12+ characters)' -AsSecureString
$env:NIRMAL_ADMIN_PASSWORD = [System.Net.NetworkCredential]::new('', $securePassword).Password
npm run admin -- create admin@your-university.edu "Campus Administrator"
Remove-Item Env:NIRMAL_ADMIN_PASSWORD
npm start
```

Students register through the sign-in screen. Administrators add workers and assign bags through the workspace. Role selection is never accepted from student registration input.

## Password reset delivery

Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `MAIL_FROM` in `.env`. Reset links use `APP_ORIGIN`, expire after 30 minutes, and revoke existing sessions when redeemed. Password reset requests return the same response for known and unknown accounts when mail is configured. SMTP errors are logged without tokens or passwords.

Without SMTP, the form explains that delivery is unavailable. An operator with local database access can generate a reset link after verifying the account owner:

```powershell
npm run admin -- reset student@your-university.edu
```

Deliver the link privately. It is a credential; do not put it in tickets or public logs. Real SMTP delivery has not been tested in this environment; integration tests use a captured test transport.

## Architecture

`src/` contains the original React interface. `server/app.js` defines HTTP endpoints and authorization. `server/db.js` creates the relational SQLite schema and transaction helper. `server/security.js` handles validation and password/session primitives. `server/images.js` decodes and re-encodes evidence. `scripts/` provides explicit provisioning and notice generation.

The API and compiled client use a single origin and one server. The default listener is loopback only. The SQLite database uses foreign keys, WAL, uniqueness constraints, and a single active collection per bag. Images are database blobs; no user-controlled upload filenames are served. Passwords are salted hashes, and session/reset secrets are stored only as SHA-256 digests. The browser stores only the theme preference in localStorage.

## Verification and remaining limits

```powershell
npm test
npm run check:ui
npm run build
npm audit
```

Verified in this workspace:

- Nine tests covering account boundaries, roles, CSRF rejection, sessions, collection lifecycle, complaint lifecycle, stale writes, private evidence, image rejection/resize, feedback, reopening, password resets, settings, activation, notification ownership, and persistence.
- Thirty-four server-render checks of populated/empty student/admin pages and authentication views.
- Production build and HTTP health/root responses.
- npm audit reported zero known dependency vulnerabilities at installation time. This is not a security certification.

The browser access host was unavailable, so browser interaction, responsive visual layout, and accessibility have **not** been visually verified. Render checks are not a substitute for browser tests.

This is a runnable, production-oriented foundation, not a certified production deployment. Before a public campus launch, configure HTTPS and secure cookies (`NODE_ENV=production`), validate mail delivery and email ownership, add campus SSO/MFA as appropriate, establish backups and retention policy, run load/security/browser/accessibility checks, and review operational requirements. SQLite uses Node's currently experimental built-in API; pin and test your Node version. The current schema bootstrap is for new installations; future schema changes need versioned migrations. The synchronous database/image processing and in-memory rate limiter are intended for a single modest instance, not a horizontally scaled deployment. Lists currently load campus records in full; large campuses need pagination and query limits. Notifications are in-app and refresh every 30 seconds; no push/SMS or background SLA escalation is implemented. JPEG EXIF orientation is discarded rather than applied. This application does not reuse or provide a new native Flutter client, QR scanning, OTP handover, or AI classification.

## Source and licensing

See [PROVENANCE.md](PROVENANCE.md) for the application?s assets and dependencies.

[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) preserves installed dependency notices, including the Inter font license and Lucide attribution. The build also publishes them at `/third-party-notices.txt`. Regenerate with `npm run licenses` when dependencies or installation platforms change. The project's own distribution license has deliberately not been assigned on your behalf; `private: true` prevents accidental npm publication. Preserve third-party terms independently of whichever license you choose for your application.
