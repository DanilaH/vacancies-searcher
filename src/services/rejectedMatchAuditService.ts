import { VacancyDatabase } from "../db/database";
import { SearchProfilesEvaluation } from "./multiProfileMatching";

export function trySaveRejectedAudit(
  database: VacancyDatabase,
  evaluation: SearchProfilesEvaluation,
  userId: string,
  vacancyId: number,
  ownerUserId: string | undefined
): void {
  if (evaluation.result !== null) return;
  if (evaluation.evaluations.length === 0) return;
  if (userId !== ownerUserId) return;

  const owner = database.getBotUser(userId);
  if (!owner?.isActive) return;

  const bestScore = Math.max(
    ...evaluation.evaluations.map((e) => e.filterResult.score)
  );
  const allReasons = evaluation.evaluations.flatMap(
    (e) => e.filterResult.rejectionReasons ?? []
  );
  const reason = [...new Set(allReasons)].join(", ");

  database.saveRejectedAuditCandidate(
    userId,
    vacancyId,
    Number.isFinite(bestScore) ? bestScore : null,
    reason || null
  );
}
