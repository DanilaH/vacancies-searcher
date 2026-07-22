# Next Task

Current branch: `feature/fuzzy-vacancy-dedup` (PR #19)

## What's Done

### Fuzzy Vacancy Dedup (PR #19)
- `src/services/vacancyFuzzyMatcher.ts` — core service: Dice coefficient, feature extraction (company, seniority, salary, location, remote), scoring with confirmatory-signal gate
- Scoring rewritten: requires ≥1 strong confirmatory signal; unknown attributes no longer award partial score; company-only matches with low title similarity (<0.70) are rejected
- Ingestor restructured: `findAndRecordFuzzyDuplicate` runs before `matchVacancyForEligibleUsers`, returns `number | null`, skips match/notify on hit
- `src/db/database.ts`: `listFuzzyMatchCandidates` (indexed LIMIT query), `recordVacancyFuzzyDuplicate` (ordered INSERT OR IGNORE), `listVacancyDuplicatePosts` updated to UNION fuzzy sources
- `src/db/schema.ts`: `vacancy_fuzzy_duplicates` table
- `src/types.ts`: `AnalyticsEventName` includes `vacancy_fuzzy_duplicate_found`
- 14 unit tests for fuzzy matcher (4 shouldConsiderFuzzyMatch + 10 computeFuzzyMatch) — all pass
- 2 integration tests (full pipeline via VacancyIngestor with real temp DB) — all pass
- 566/566 full suite pass, typecheck clean, build clean

### All 4 Review Blocks Addressed
1. ~~Fuzzy check ran too late~~ — **fixed**: runs before matching
2. ~~Scoring merged by common profession without confirmatory signals~~ — **fixed**: requires ≥1 confirmatory signal, unknown attribs no longer score, company-only + low titleSim rejected
3. Missing integration tests — **fixed**: 2 integration tests added
4. ~~Candidate query loaded all vacancies~~ — **fixed**: `listFuzzyMatchCandidates` uses LIMIT

## Next Possible Steps

1. Update PR #19 description with final test counts and verification results; do not merge yet
2. Request code review from PR reviewers
3. After merge: update AGENTS.md, CURRENT_STATE.md with final fuzzy dedup feature

## Verification

```powershell
npm test
npm run build
npx tsc -p tsconfig.json --pretty false
```
