# Codk7 Final Verification Record

Verification date: 2026-08-07

## Scope and source of truth

This archive is an in-place repair of the supplied Codk7 project. The existing React/Express/local-SQLite architecture and UI are preserved.

The supplied official Login Data PDF remains the sole source of truth for login identities, IDs, emails, roles, and passwords. The source contains exactly 16 official accounts and five application roles:

- 1 System Admin
- 1 Registrar Admin
- 1 Student Affairs Admin
- 5 Advisors
- 8 Students

Plaintext PDF passwords are not stored in the project. Only salted scrypt hashes are kept in `database/dataset.ts`.

## Repairs in this release

- `tests/database-path.test.ts` now exercises `database/sqlite.ts` directly and contains no `@libsql/client` dependency.
- `tests/browser-smoke.mjs` no longer assumes GPA `3.50`. It reads the authenticated seeded profile API value and compares it with the dashboard through the stable `data-testid="student-overview-gpa"` selector.
- Added the missing `GET /api/admin/student/:id/detail` endpoint used by `api.studentDetail()`. It permits the three Admin roles and Advisors, while Advisors remain restricted to assigned students.
- Added the missing staff advising endpoint `GET /api/admin/student/:id/advising` used by `api.staffAdvising()` with the same assigned-student Advisor scope.
- Added the three backend routes already required by the Advisor notes frontend API: `GET /api/advisor/notes/:id`, `POST /api/advisor/notes`, and `POST /api/advisor/notes/delete`. Notes remain private to the owning Advisor and assigned student scope.
- Expanded API integration assertions for the new routes and RBAC boundaries.
- Removed the remaining stale `libsql` wording from the advising implementation comment.
- Added `npm run verify:release`, which chains database readiness/verification, database tests, TypeScript, ESLint, unit/API/browser tests, production build, and production smoke tests.

## Checks completed successfully in this sandbox

### Official login data

A local credential check derived each of the 16 stored salted scrypt hashes from the official PDF password for that account and compared the result to `database/dataset.ts`:

- 16 / 16 official credentials matched.
- No plaintext passwords were written into the project.

### Fresh database build and verifier

The current TypeScript database source was transpiled only for execution in an isolated temporary verification directory, then used to seed a brand-new SQLite file and run the project's database verifier.

Fresh seed counts:

- majors: 6
- users: 16
- students: 8
- courses: 110
- study_plan_items: 159
- course_prerequisites: 93
- enrollments: 54

The verifier reported **All checks passed**, including:

- SQLite `quick_check`
- foreign-key enforcement and `foreign_key_check`
- schema version 6
- credential source = official login PDF
- sealed official account state
- exactly 16 official users and no duplicate emails
- exact official IDs, names, emails, roles, and credential hashes
- salted scrypt credentials for every account
- role counts 1 / 1 / 1 / 5 / 8
- exactly 8 student academic records and valid Advisor assignments
- no plaintext session-token column
- account-protection triggers present and effective
- official identity/credential mutation rejected
- official account deletion rejected
- insertion of a 17th account rejected

### Frontend/backend route audit

A source audit normalized all endpoint templates in `src/api.ts` and compared them with Express routes in `server.ts`:

- frontend API calls checked (method + normalized path): 29
- matching server API routes found: 29
- frontend calls with no matching backend route: **0**

### Source integrity/static checks

- 51 TypeScript/TSX implementation files transpiled with the installed TypeScript compiler with 0 syntax diagnostics.
- No `@libsql/client` references remain.
- No disabled/skipped/`.only` tests were found.
- No demo-user/demo-password fallback was added.
- The browser smoke test uses the real authenticated profile API value rather than a fabricated GPA.
- `package-lock.json` was not changed by these repairs.


## Final archive extraction verification

A release ZIP was created with the requested exclusions, extracted to a fresh directory, and the extracted project was checked again. The post-extraction checks passed for:

- archive exclusion audit (no `node_modules`, `dist`, `.git`, logs, runtime database files, secret `.env` files, or temporary directories)
- byte-for-byte match between every packaged file and the prepared source
- unchanged official `package-lock.json`
- all 29 frontend API calls matched by method and normalized path to backend routes
- 51 TypeScript/TSX implementation files with 0 transpilation syntax diagnostics
- no obsolete `@libsql/client` reference and no skipped/focused test pattern
- 16 / 16 official PDF credentials matching the stored salted scrypt hashes
- fresh isolated database seed and full database verifier (`All checks passed`)
- special-character SQLite file URL/path smoke test (`space` and `#`) using the actual local SQLite adapter

## Genuine retained academic-source limitations

The supplied academic source data still has eight pre-existing documented gaps/conflicts, which the seeder reports instead of inventing values:

- Missing Diploma Second Year plan for Cyber and Information Security.
- Missing Diploma Second Year plan for Data Science and Artificial Intelligence.
- CSDS4105 references missing prerequisite CSIS3609; left unset.
- MATH1202 references foundation-programme prerequisite FPMP0003 outside this catalogue.
- CSCM1101 lists `Computer Skills` rather than a course code as prerequisite.
- CSSY3201 has conflicting titles; the core-plan title is retained.
- CSSE4101 has conflicting titles; the Software Engineering core-plan title is retained.
- Duplicate/conflicting title groups remain as reported by the existing source-data conflict record.

No missing academic data was invented to hide these limitations.

## Environment limitation: full npm release gate could not be executed here

The supplied project archive does not contain `node_modules` (correct for a release archive). A clean dependency installation was attempted from the unchanged `package-lock.json` with:

```bash
npm ci --ignore-scripts --no-audit --fund=false
```

The sandbox's configured npm repository returned HTTP 404 for the locked `yocto-queue@0.1.0` tarball before dependency installation could complete. Direct public package-registry access is blocked by this execution environment. Because the exact locked dependency tree could not be installed, this sandbox cannot truthfully claim fresh execution of the dependency-backed commands below after the source repairs:

- `npm run typecheck`
- `npm run lint`
- `npm run test:db`
- `npm run test:unit`
- `npm run test:api`
- `npm run test:browser`
- `npm run build`
- `npm run test:production`
- `npm run verify:release`

No test was skipped, disabled, converted to a pass, or routed through Mock Mode to work around this infrastructure failure.

## Required final target-host gate

On a host with working npm registry access, extract the archive into a clean directory and run:

```bash
npm ci
npm run verify:release
```

`verify:release` is the single release gate added by this repair. Full production readiness should be declared only when that command completes successfully with the exact locked dependencies. This record intentionally does **not** claim the unavailable npm-backed suite passed in this sandbox.
