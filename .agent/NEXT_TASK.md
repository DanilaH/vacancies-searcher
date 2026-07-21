# Next Task

No active task file.

Current branch: `feat/rejected-match-audit-sample` (PR #15)

## What's Done

- New `rejected_match_audit` table with migration
- DB methods: `saveRejectedAuditCandidate`, `countUnreviewedRejectedAudit`, `getRejectedMatchAudit`, `pruneUnreviewedRejectedAudit`
- Auto-cleanup to 500 unverified per owner on save
- Verified records never evicted
- Recording in both `UserVacancyRematcher.rebuildForUser` and `VacancyIngestor.matchVacancyForEligibleUsers` via shared helper `trySaveRejectedAudit`
- 12 tests covering save, idempotency, owner-only, rejected-only, limit 500, cleanup, verified-kept, integration
- PR #15 created into master

## Next Possible Steps

1. Create Telegram command for owner to browse/verify audit records
2. Calculate false negative rate from reviewed audit records
3. Wire into `VacancyIngestor.matchVacancyForEligibleUsers` for real-time ingestion path
