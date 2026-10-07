import type { ErrorCode, MatchInput, Question } from './types.js';

export class RuleViolation extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
  }
}
export function requireRule(
  condition: boolean,
  code: ErrorCode,
): asserts condition {
  if (!condition) throw new RuleViolation(code);
}
export function isTimestamp(value: number): boolean {
  // Leave room for every supported phase deadline without losing integer precision.
  return (
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER - 60_000
  );
}
function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
export function validateMatchInput(input: MatchInput): void {
  requireRule(
    nonempty(input.id) &&
      (input.mode === 'solo' || input.mode === 'multiplayer'),
    'INVALID_SETTINGS',
  );
  requireRule(
    Number.isInteger(input.settings.rounds) &&
      input.settings.rounds >= 1 &&
      input.settings.rounds <= 10 &&
      Number.isInteger(input.settings.answerTimeMs) &&
      input.settings.answerTimeMs >= 5_000 &&
      input.settings.answerTimeMs <= 60_000 &&
      input.settings.answerTimeMs % 1_000 === 0,
    'INVALID_SETTINGS',
  );
  requireRule(
    input.participants.length >= 1 &&
      input.participants.length <= 10 &&
      (input.mode !== 'solo' || input.participants.length === 1) &&
      new Set(input.participants.map((p) => p.id)).size ===
        input.participants.length &&
      new Set(input.participants.map((p) => p.order)).size ===
        input.participants.length &&
      input.participants.every(
        (p) =>
          nonempty(p.id) &&
          nonempty(p.name) &&
          Number.isInteger(p.order) &&
          p.order >= 1 &&
          (p.presence === 'online' || p.presence === 'offline'),
      ),
    'INVALID_PARTICIPANTS',
  );
  requireRule(
    input.categories.length >= input.settings.rounds &&
      new Set(input.categories.map((c) => c.id)).size ===
        input.categories.length &&
      input.categories.every(
        (c) => nonempty(c.id) && nonempty(c.name) && nonempty(c.language),
      ),
    'INVALID_CATEGORIES',
  );
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function parseQuestion(value: unknown, categoryId: string): Question | null {
  if (
    !isRecord(value) ||
    !nonempty(value.id) ||
    value.categoryId !== categoryId ||
    !nonempty(value.language) ||
    !nonempty(value.text) ||
    (value.type !== 'single' && value.type !== 'multiple') ||
    !Array.isArray(value.options) ||
    ![2, 4, 6].includes(value.options.length) ||
    !Array.isArray(value.correctOptionIds)
  )
    return null;
  const options: { id: string; text: string }[] = [];
  for (const option of value.options) {
    if (!isRecord(option) || !nonempty(option.id) || !nonempty(option.text))
      return null;
    options.push({ id: option.id, text: option.text });
  }
  const correctOptionIds: string[] = [];
  for (const id of value.correctOptionIds) {
    if (!nonempty(id)) return null;
    correctOptionIds.push(id);
  }
  if (
    new Set(options.map((o) => o.id)).size !== options.length ||
    new Set(correctOptionIds).size !== correctOptionIds.length ||
    correctOptionIds.some((id) => !options.some((o) => o.id === id)) ||
    (value.type === 'single'
      ? correctOptionIds.length !== 1
      : correctOptionIds.length < 1 ||
        correctOptionIds.length >= options.length)
  )
    return null;
  return {
    id: value.id,
    categoryId,
    language: value.language,
    text: value.text,
    type: value.type,
    options,
    correctOptionIds,
  };
}
/** Provider payloads are untrusted. Return detached, validated question instances. */
export function parseQuestionBatch(
  value: unknown,
  categoryId: string,
  existingQuestionIds: readonly string[] = [],
): readonly Question[] | null {
  if (!Array.isArray(value) || value.length !== 5) return null;
  const questions: Question[] = [];
  const seen = new Set(existingQuestionIds);
  for (const item of value) {
    const question = parseQuestion(item, categoryId);
    if (!question || seen.has(question.id)) return null;
    seen.add(question.id);
    questions.push(question);
  }
  return questions;
}
export function validateAnswer(
  question: Question,
  selected: readonly string[],
): readonly string[] {
  requireRule(
    Array.isArray(selected) &&
      selected.length > 0 &&
      (question.type !== 'single' || selected.length === 1) &&
      new Set(selected).size === selected.length &&
      selected.every((id) => question.options.some((o) => o.id === id)),
    'INVALID_ANSWER',
  );
  // Selection is a set; canonical order makes receipts independent of device ordering.
  return question.options
    .filter((o) => selected.includes(o.id))
    .map((o) => o.id);
}
