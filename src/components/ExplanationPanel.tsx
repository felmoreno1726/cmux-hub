import React, { useMemo, useRef, useState } from "react";
import { Sparkles, Minus, Plus } from "lucide-react";
import { api } from "../lib/api.ts";
import { DETAIL_LEVELS, selectFilePatch } from "../lib/explanations.ts";
import type {
  ExplanationProvider,
  ExplanationRequest,
  ExplanationResult,
} from "../lib/explanations.ts";
import type { ParsedDiff } from "../lib/diff-parser.ts";
import "./explanations.css";

type Props = {
  patch: string;
  files: ParsedDiff;
  source: string;
  selectedFile: string;
  onSelectFile: (file: string) => void;
  isRefreshing: boolean;
  isVisible: boolean;
};
type Answer = { key: string; result: ExplanationResult };
const MAX_SAVED_ANSWERS = 30;

export function ExplanationPanel({
  patch,
  files,
  source,
  selectedFile,
  onSelectFile,
  isRefreshing,
  isVisible,
}: Props) {
  const [depth, setDepth] = useState(1);
  const [provider, setProvider] = useState<ExplanationProvider>("claude");
  const [scope, setScope] = useState<"current" | "reviewed">("current");
  const [checkpoints, setCheckpoints] = useState<Record<string, string>>({});
  const [answers, setAnswers] = useState(new Map<string, Answer>());
  const cache = useRef(new Map<string, ExplanationResult>());
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const file =
    scope === "current" && files.some((entry) => entry.newPath === selectedFile)
      ? selectedFile
      : "";
  const checkpoint = checkpoints[source];
  const input = useMemo<ExplanationRequest>(
    () => ({
      patch: file ? selectFilePatch(patch, file) : patch,
      depth,
      provider,
      source,
      ...(file ? { file } : {}),
      ...(scope === "reviewed" && checkpoint !== undefined ? { previousPatch: checkpoint } : {}),
    }),
    [patch, file, depth, provider, source, scope, checkpoint],
  );
  const key = JSON.stringify(input);
  const context = JSON.stringify({ source, file, scope, depth, provider });
  const saved = answers.get(context);
  const cached = cache.current.get(key);
  const answer = cached ? { key, result: cached } : saved;
  const isStale = Boolean(answer && answer.key !== key);
  const needsCheckpoint = scope === "reviewed" && checkpoint === undefined;

  async function requestExplanation() {
    if (pending || needsCheckpoint || isRefreshing) return;
    setFailure(null);
    setPending(true);
    try {
      const result = cache.current.get(key) ?? (await api.explain(input));
      cache.current.set(key, result);
      if (cache.current.size > MAX_SAVED_ANSWERS)
        cache.current.delete(cache.current.keys().next().value!);
      setAnswers((previous) => {
        const next = new Map(previous).set(context, { key, result });
        if (next.size > MAX_SAVED_ANSWERS) next.delete(next.keys().next().value!);
        return next;
      });
    } catch (error) {
      setFailure({
        key,
        message: error instanceof Error ? error.message : "The explanation failed. Try again.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <aside className="explanation-panel" aria-label="AI explanations" hidden={!isVisible}>
      <div className="explanation-heading">
        <Sparkles size={16} />
        <h2>Understand the changes</h2>
      </div>
      <p className="explanation-muted">What changed, why it matters, and what to check.</p>
      <div className="explanation-tabs" role="group" aria-label="Explanation scope">
        <button aria-pressed={scope === "current"} onClick={() => setScope("current")}>
          Current diff
        </button>
        <button aria-pressed={scope === "reviewed"} onClick={() => setScope("reviewed")}>
          Since reviewed
        </button>
      </div>
      <p className="explanation-source" title={source}>
        {source}
      </p>
      {scope === "current" ? (
        <label className="explanation-field">
          Explain
          <select
            aria-label="File to explain"
            value={file}
            onChange={(event) => onSelectFile(event.target.value)}
          >
            <option value="">Whole diff · {files.length} files</option>
            {files.map((entry) => (
              <option key={entry.newPath} value={entry.newPath}>
                {entry.newPath}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="explanation-muted">
          {needsCheckpoint
            ? "Mark this diff reviewed to save a starting point. Come back after more code changes."
            : "Compare the current diff with the point you marked reviewed in this page."}
        </p>
      )}
      <div className="explanation-controls">
        <label className="explanation-field">
          Provider
          <select
            aria-label="Provider"
            value={provider}
            onChange={(event) => setProvider(event.target.value as ExplanationProvider)}
          >
            <option value="claude">Claude</option>
            <option value="codex">Codex</option>
          </select>
        </label>
        <div className="explanation-field">
          Detail
          <div className="explanation-depth">
            <button
              aria-label="Less detail"
              disabled={depth === 0}
              onClick={() => setDepth(depth - 1)}
            >
              <Minus size={14} />
            </button>
            <span>{DETAIL_LEVELS[depth]}</span>
            <button
              aria-label="More detail"
              disabled={depth === DETAIL_LEVELS.length - 1}
              onClick={() => setDepth(depth + 1)}
            >
              <Plus size={14} />
            </button>
          </div>
        </div>
      </div>
      <button
        className="explanation-submit"
        disabled={pending || needsCheckpoint || isRefreshing}
        onClick={requestExplanation}
      >
        {pending ? "Explaining…" : isStale ? "Update explanation" : "Explain changes"}
      </button>
      <div className="explanation-answer" aria-live="polite" aria-busy={pending}>
        {isStale && (
          <p className="explanation-stale">Code changed. This answer describes an earlier diff.</p>
        )}
        {failure?.key === key && (
          <p role="alert" className="explanation-error">
            {failure.message}
          </p>
        )}
        {answer ? (
          <>
            <div className="explanation-text">{answer.result.text}</div>
            <p className="explanation-muted explanation-metadata">
              {answer.result.model}
              {cached || answer.result.cached ? " · Saved answer" : ""}
              {answer.result.sampled ? " · Some code omitted" : ""}
            </p>
          </>
        ) : (
          <p className="explanation-empty">
            {pending
              ? "Reading the diff. You can keep browsing the code."
              : "Choose a scope and click Explain changes. No AI runs while you browse."}
          </p>
        )}
      </div>
      <div className="explanation-footer">
        <button
          disabled={isRefreshing || pending}
          onClick={() => setCheckpoints((previous) => ({ ...previous, [source]: patch }))}
        >
          {checkpoint === patch ? "Review point saved" : "Mark this diff reviewed"}
        </button>
        <p className="explanation-muted">
          Uses your signed-in CLI. The selected diff is sent to your provider only when you ask.
          Review points last until this page closes.
        </p>
      </div>
    </aside>
  );
}
