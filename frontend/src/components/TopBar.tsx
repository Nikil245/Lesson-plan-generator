import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { API_BASE_URL, LessonPlan, lessonPlanToMarkdown } from '../api/client';

interface TopBarProps {
  lessonTitle: string;
  onChangeTitle: (title: string) => void;
  onNewLesson: () => void;
  sessionId: string;
  plan: LessonPlan | null;
  sourcesCount: number;
}

export const TopBar: React.FC<TopBarProps> = ({
  lessonTitle,
  onChangeTitle,
  onNewLesson,
  sessionId,
  plan,
  sourcesCount,
}) => {
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [sharedCopied, setSharedCopied] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const handleShare = async () => {
    const textToCopy = plan
      ? lessonPlanToMarkdown(plan)
      : `Lessonwright — ${lessonTitle || 'Untitled lesson'} (Session: ${sessionId})`;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setSharedCopied(true);
      setTimeout(() => setSharedCopied(false), 2000);
    } catch {
      // Fallback copy
      const textarea = document.createElement('textarea');
      textarea.value = textToCopy;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setSharedCopied(true);
      setTimeout(() => setSharedCopied(false), 2000);
    }
  };

  return (
    <header className="h-14 sm:h-16 w-full px-4 flex items-center justify-between flex-shrink-0 bg-transparent relative">
      {/* Left branding, Home link & editable title */}
      <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
        <Link
          to="/"
          aria-label="Lessonwright Home"
          className="flex items-center gap-2 flex-shrink-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-accent bg-accent-soft">
            <span className="material-symbols-outlined text-[20px]">
              auto_stories
            </span>
          </div>
          <span className="text-[15px] font-semibold text-ink tracking-tight">
            Lessonwright
          </span>
        </Link>

        <span className="text-ink-subtle text-[15px] font-normal hidden sm:inline">
          /
        </span>

        <Link
          to="/"
          className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[13px] font-medium text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <span className="material-symbols-outlined text-[16px]">home</span>
          <span>Home</span>
        </Link>

        <span className="text-ink-subtle text-[15px] font-normal">/</span>

        <div
          onClick={() => titleInputRef.current?.focus()}
          className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-surface-hover transition-colors cursor-pointer group min-w-0"
        >
          <input
            ref={titleInputRef}
            type="text"
            spellCheck={false}
            value={lessonTitle}
            onChange={(e) => onChangeTitle(e.target.value)}
            aria-label="Lesson title"
            className="bg-transparent border-0 text-[14px] font-medium text-ink focus:outline-none w-28 sm:w-48 cursor-pointer focus:cursor-text p-0 truncate"
          />
          <span className="material-symbols-outlined text-ink-muted group-hover:text-ink text-[15px] flex-shrink-0">
            edit
          </span>
        </div>
      </div>

      {/* Right utility controls */}
      <div className="flex items-center gap-1.5 sm:gap-2.5 flex-shrink-0">
        <Link
          to="/"
          aria-label="Home"
          className="sm:hidden px-2.5 py-1.5 rounded-full text-[13px] font-medium text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <span className="material-symbols-outlined text-[18px]">home</span>
        </Link>

        <button
          type="button"
          onClick={onNewLesson}
          className="px-3 sm:px-3.5 py-1.5 rounded-full text-[13px] sm:text-[14px] font-medium text-ink hover:bg-surface-hover transition-colors flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <span className="material-symbols-outlined text-ink-muted text-[18px]">
            add
          </span>
          <span className="hidden xs:inline sm:inline">New lesson</span>
        </button>

        <button
          type="button"
          onClick={handleShare}
          title={
            plan
              ? 'Copy lesson plan Markdown to clipboard'
              : 'Copy session info to clipboard'
          }
          className="px-3.5 sm:px-4 py-1.5 rounded-full bg-accent hover:bg-accent-hover text-white text-[13px] sm:text-[14px] font-medium transition-colors flex items-center gap-1.5"
        >
          <span className="material-symbols-outlined text-[17px]">
            {sharedCopied ? 'check' : 'ios_share'}
          </span>
          <span>{sharedCopied ? 'Copied' : 'Share'}</span>
        </button>

        <div className="relative">
          <button
            type="button"
            aria-label="Settings"
            onClick={() => setSettingsOpen((prev) => !prev)}
            className="w-8 h-8 rounded-full flex items-center justify-center text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors ml-0.5"
          >
            <span className="material-symbols-outlined text-[19px]">
              settings
            </span>
          </button>

          {settingsOpen && (
            <div className="absolute right-0 mt-2 w-72 rounded-panel bg-surface border border-border p-4 z-50 text-left">
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-[13px] font-semibold text-ink">
                  Workspace Info
                </span>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(false)}
                  className="text-ink-muted hover:text-ink"
                >
                  <span className="material-symbols-outlined text-[16px]">
                    close
                  </span>
                </button>
              </div>
              <div className="space-y-2 text-[12px]">
                <div className="flex flex-col gap-0.5">
                  <span className="text-ink-muted">Backend API</span>
                  <code className="font-mono text-[11px] bg-surface-muted border border-border rounded px-2 py-1 text-ink">
                    {API_BASE_URL}
                  </code>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-ink-muted">Session ID</span>
                  <code className="font-mono text-[11px] bg-surface-muted border border-border rounded px-2 py-1 text-ink truncate">
                    {sessionId}
                  </code>
                </div>
                <div className="flex items-center justify-between pt-1 border-t border-border text-ink-muted">
                  <span>Indexed sources</span>
                  <span className="font-medium text-ink">{sourcesCount}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="w-8 h-8 rounded-full bg-surface-avatar border border-border-avatar flex items-center justify-center text-ink-avatar text-[13px] font-medium select-none ml-1">
          LW
        </div>
      </div>
    </header>
  );
};

