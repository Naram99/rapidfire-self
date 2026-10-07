import type {
  AcceptedAnswer,
  Participant,
  Question,
  QuestionResult,
  Standing,
} from './types.js';

/** Internal questions/answers have already passed validation. */
export function scoreAnswer(
  question: Question,
  answer: AcceptedAnswer | undefined,
  openedAt: number,
  answerTimeMs: number,
): Pick<
  QuestionResult,
  | 'outcome'
  | 'pointsAwarded'
  | 'selectedCorrectCount'
  | 'selectedIncorrectCount'
> {
  if (!answer)
    return {
      outcome: 'unanswered',
      pointsAwarded: 0,
      selectedCorrectCount: 0,
      selectedIncorrectCount: 0,
    };
  const selectedCorrectCount = answer.selectedOptionIds.filter((id) =>
    question.correctOptionIds.includes(id),
  ).length;
  const selectedIncorrectCount =
    answer.selectedOptionIds.length - selectedCorrectCount;
  const isCorrect =
    selectedCorrectCount === question.correctOptionIds.length &&
    selectedIncorrectCount === 0;
  const outcome = isCorrect
    ? 'correct'
    : selectedCorrectCount > 0 && question.type === 'multiple'
      ? 'partial'
      : 'incorrect';
  const quality =
    question.type === 'single'
      ? Number(isCorrect)
      : Math.max(
          0,
          selectedCorrectCount / question.correctOptionIds.length -
            selectedIncorrectCount /
              (question.options.length - question.correctOptionIds.length),
        );
  const elapsed = Math.max(
    0,
    Math.min(answerTimeMs, answer.receivedAt - openedAt),
  );
  return {
    outcome,
    pointsAwarded: Math.round(
      quality * (500 + 500 * (1 - elapsed / answerTimeMs)),
    ),
    selectedCorrectCount,
    selectedIncorrectCount,
  };
}
export function rankParticipants(
  participants: readonly Participant[],
): readonly Standing[] {
  const sorted = [...participants].sort(
    (a, b) => b.score - a.score || a.order - b.order,
  );
  let previousScore: number | undefined;
  let rank = 0;
  return sorted.map((participant, index) => {
    if (participant.score !== previousScore) rank = index + 1;
    previousScore = participant.score;
    return { participantId: participant.id, score: participant.score, rank };
  });
}
