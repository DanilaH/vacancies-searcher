# Next Task

Current branch: `feature/fuzzy-vacancy-dedup` (PR #19)

## What's Done

All 5 review blocks are resolved:

### 1. Per-user fuzzy dedup (Issue 1)
- Fuzzy duplicate no longer blocks matching for all users
- `findAndRecordFuzzyDuplicate` returns `FuzzyDuplicateGroup | null` with `groupVacancyIds`
- `matchVacancyForEligibleUsers` accepts optional `fuzzyGroupVacancyIds`; skips users who already matched any vacancy in the group
- `database.hasUserMatchedAnyVacancy(userId, vacancyIds)` — efficient LIMIT 1 query

### 2. Fuzzy chain / root linking (Issue 2)
- New fuzzy links are created against the root (oldest ID) of the candidate's fuzzy group
- `database.getFuzzyGroupRootId(vacancyId)` — min ID in connected component
- `database.getFuzzyGroupVacancyIds(vacancyId)` — transitive BFS closure
- `listVacancyDuplicatePosts` UNIONs fuzzy sources → root card shows all group members

### 3. Regression tests (Issue 3)
- 9 integration tests covering: per-user dedup, chain linking, fingerprint coexistence, raw record preservation, duplicate match prevention, status/feedback/reminder integrity, source listing
- All use real production components (DB, VacancyIngestor, BotController)

### 4. Candidate pre-filtering (Issue 4)
- `listFuzzyMatchCandidates` accepts `titleTokens?: string[]` for SQL `LIKE` pre-filtering
- `findAndRecordFuzzyDuplicate` extracts top 5 significant tokens from title
- `idx_vacancies_message_date` index added to schema migrations
- Exclude words list mirrors `vacancyFuzzyMatcher`'s `EXCLUDE_TITLE_WORDS`

### 5. Verification
- **575/575 tests pass** (18 unit + 2 integration + 9 regression for fuzzy, rest unchanged)
- `npx tsc` — clean
- `npm run build` — clean

## Next Steps

1. Check PR merge status and update description
2. Request final review from PR reviewers
3. Do not merge

## Changed Files

- `src/db/database.ts` — `getFuzzyGroupVacancyIds`, `getFuzzyGroupRootId`, `hasUserMatchedAnyVacancy`; `listFuzzyMatchCandidates` accepts `titleTokens`; `recordVacancyFuzzyDuplicate` unchanged
- `src/db/schema.ts` — `idx_vacancies_message_date` index
- `src/services/vacancyIngestor.ts` — `findAndRecordFuzzyDuplicate` returns `FuzzyDuplicateGroup | null`, links to root; `matchVacancyForEligibleUsers` accepts `fuzzyGroupVacancyIds`; `handle` no longer skips matching entirely
- `tests/vacancyFuzzyRegression.test.ts` — 9 integration tests
- `tests/vacancyFuzzyIngestion.test.ts` — 2 integration tests (unchanged)
- `tests/vacancyFuzzyMatcher.test.ts` — 14 unit tests (unchanged)

## Verification

```powershell
npm test
npm run build
npx tsc -p tsconfig.json --pretty false
```
