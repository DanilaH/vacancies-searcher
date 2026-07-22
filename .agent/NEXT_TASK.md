# Next Task

PR #21 (`feat/fuzzy-dedup-report`) is open — owner-only `/fuzzyreport` command showing fuzzy duplicate stats for the last 30 days.

## Report content

- Total fuzzy links created
- Unique fuzzy groups (connected components via union-find)
- Average/min/max score
- Score buckets: `0.35–0.49`, `0.50–0.69`, `0.70–0.84`, `0.85–1.00`
- Top 10 source/channel pairs by link count
- Group size distribution: 2, 3, 4+
- Last match date
- Zero-state when no data

## Key files

- `src/db/database.ts` — `getFuzzyDedupStats(sinceIso)` with SQL aggregation + union-find for groups
- `src/types.ts` — `FuzzyDedupStats` interface
- `src/services/fuzzyDedupReport.ts` — `buildFuzzyDedupReport(database, days?, now?)`
- `src/bot/fuzzyDedupReportHandler.ts` — `handleFuzzyDedupReportCommand(ctx, database)`
- `src/bot/createBot.ts` — command registered in `OWNER_BOT_COMMANDS` + handler
- `tests/fuzzyDedupReport.test.ts` — 16 tests covering aggregation, groups, buckets, filtering, access, and privacy

## Verification

```powershell
npx tsc -p tsconfig.json --pretty false
npm test
npm run build
```
