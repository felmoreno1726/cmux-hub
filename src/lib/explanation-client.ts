import { api } from "./api.ts";
import type { ExplanationRequest, ExplanationResult } from "./explanations.ts";

export type InlineExplanationRequest = Omit<ExplanationRequest, "provider" | "previousPatch">;
const MAX_SAVED_ANSWERS = 100;
const answers = new Map<string, ExplanationResult>();
type PendingExplanation = { request: Promise<ExplanationResult>; readers: Set<AbortSignal> };
const pending = new Map<string, PendingExplanation>();
let queue: Promise<unknown> = Promise.resolve();

export function getSavedExplanation(input: InlineExplanationRequest) {
  return answers.get(JSON.stringify(input));
}

export function requestInlineExplanation(
  input: InlineExplanationRequest,
  signal: AbortSignal,
): Promise<ExplanationResult> {
  const key = JSON.stringify(input);
  const saved = answers.get(key);
  if (saved) return Promise.resolve(saved);
  const existing = pending.get(key);
  if (existing) {
    existing.readers.add(signal);
    return existing.request;
  }
  const readers = new Set([signal]);
  const request = queue.then(async () => {
    if ([...readers].every((reader) => reader.aborted))
      throw new DOMException("The diff is no longer visible.", "AbortError");
    const { provider } = await api.getExplanationSettings();
    if ([...readers].every((reader) => reader.aborted))
      throw new DOMException("The diff is no longer visible.", "AbortError");
    const result = await api.explain({ ...input, provider });
    answers.set(key, result);
    if (answers.size > MAX_SAVED_ANSWERS) answers.delete(answers.keys().next().value!);
    return result;
  });
  queue = request.then(
    () => undefined,
    () => undefined,
  );
  pending.set(key, { request, readers });
  void request.then(
    () => pending.delete(key),
    () => pending.delete(key),
  );
  return request;
}
