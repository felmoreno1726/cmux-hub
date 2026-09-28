import React, { useEffect, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { DETAIL_LEVELS } from "../lib/explanations.ts";
import type { ExplanationResult } from "../lib/explanations.ts";
import { getSavedExplanation, requestInlineExplanation } from "../lib/explanation-client.ts";
import "./inline-explanation.css";

type Props = { patch: string; source: string; file?: string; disabled: boolean };
type Answer = { patch: string; depth: number; result: ExplanationResult };
const HIDDEN_DEPTH = -1;
const SETTLE_DELAY_MS = 600;

export function InlineExplanation({ patch, source, file, disabled }: Props) {
  const [depth, setDepth] = useState(0);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [retry, setRetry] = useState(0);
  const saved = getSavedExplanation({ patch, source, file, depth });
  const displayed = saved ? { patch, depth, result: saved } : answer;
  const isStale = Boolean(displayed && displayed.patch !== patch);
  const isHidden = depth === HIDDEN_DEPTH;

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) =>
      setIsVisible(entry?.isIntersecting ?? false),
    );
    observer.observe(container.current!.closest('[data-testid="diff-file"]') ?? container.current!);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setIsPending(false);
    setError(null);
    if (!isVisible || disabled || isHidden) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setIsPending(true);
      requestInlineExplanation({ patch, source, file, depth }, controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) setAnswer({ patch, depth, result });
        })
        .catch((failure: unknown) => {
          if (!controller.signal.aborted)
            setError(failure instanceof Error ? failure.message : "Could not explain this change.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsPending(false);
        });
    }, SETTLE_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [patch, source, file, depth, isVisible, disabled, isHidden, retry]);

  const plusLabel = isHidden
    ? "More detail"
    : error
      ? "Retry explanation"
      : isStale
        ? "Refresh explanation"
        : "More detail";
  return (
    <div
      ref={container}
      className="inline-explanation"
      role="group"
      aria-label={file ? `Explanation for ${file}` : "Overall explanation"}
    >
      <span className="inline-explanation-label">{file ? "AI" : "Summary"}</span>
      <div className="inline-explanation-copy" aria-live="polite">
        {isHidden ? (
          <span className="inline-explanation-note">
            {file ? "Explain this file" : "Explain these changes"}
          </span>
        ) : (
          <>
            {displayed && (
              <span className={isStale ? "inline-explanation-old" : undefined}>
                {displayed.result.text}
              </span>
            )}
            {error ? (
              <span role="alert" className="inline-explanation-error">
                {error} Press + to retry.
              </span>
            ) : isPending ? (
              <span className="inline-explanation-note">
                {displayed ? "Updating…" : "Summarizing…"}
              </span>
            ) : isStale ? (
              <span className="inline-explanation-note">Changed · summary updating</span>
            ) : !displayed ? (
              <span className="inline-explanation-note">Summary will appear here</span>
            ) : null}
            {displayed?.result.sampled && (
              <span className="inline-explanation-note">Some code omitted</span>
            )}
          </>
        )}
      </div>
      <div className="inline-explanation-controls">
        <button
          aria-label="Less detail"
          title={depth === 0 ? "Hide explanation" : "Less detail"}
          disabled={isHidden}
          onClick={() => setDepth(depth - 1)}
        >
          <Minus size={13} />
        </button>
        <button
          aria-label={plusLabel}
          title={plusLabel}
          disabled={disabled || (!error && !isStale && depth === DETAIL_LEVELS.length - 1)}
          onClick={() =>
            isHidden ? setDepth(0) : error || isStale ? setRetry(retry + 1) : setDepth(depth + 1)
          }
        >
          <Plus size={13} />
        </button>
      </div>
    </div>
  );
}
