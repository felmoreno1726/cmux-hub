import React, { useState, useRef, useEffect } from "react";
import { Button } from "./ui/button.tsx";
import { Textarea } from "./ui/textarea.tsx";

export type CommentMode = "send" | "review";

type Props = {
  onSubmit: (comment: string, mode: CommentMode) => void;
  onCancel: () => void;
};

export function CommentForm({ onSubmit, onCancel }: Props) {
  const [comment, setComment] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSubmit = (mode: CommentMode) => {
    if (comment.trim()) {
      onSubmit(comment.trim(), mode);
      setComment("");
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSubmit("send");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (e.shiftKey) {
        handleSubmit("review");
      } else {
        handleSubmit("send");
      }
    }
    if (e.key === "Escape") {
      onCancel();
    }
  };

  const modKey = navigator.platform.includes("Mac") ? "⌘" : "Ctrl";

  return (
    <form onSubmit={handleFormSubmit} className="space-y-2">
      <Textarea
        ref={textareaRef}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Write feedback for your coding agent..."
        className="min-h-[60px] bg-gray-800 border-gray-700 text-gray-200"
        rows={3}
      />
      <p className="text-xs text-[#848d97]">
        Goes to the linked terminal, not GitHub. Keep your coding agent open there. No pull request
        is needed.
      </p>
      <div className="flex gap-2 justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!comment.trim()}
          onClick={() => handleSubmit("review")}
          title={`${modKey}+Shift+Enter`}
        >
          Queue feedback <span className="text-[#848d97] text-xs ml-1">{modKey}⇧↵</span>
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!comment.trim()}
          onClick={() => handleSubmit("send")}
          title={`${modKey}+Enter`}
        >
          Send to terminal <span className="text-[#848d97] text-xs ml-1">{modKey}↵</span>
        </Button>
      </div>
    </form>
  );
}
