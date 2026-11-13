import React, { useEffect, useRef, useState } from 'react';
import { ChatSettings, LessonPlan, SourceItem } from '../api/client';
import { ActiveCitationTarget, CitationText } from './CitationText';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  statusSteps?: string[];
  currentStatus?: string | null;
  isStreaming?: boolean;
  sources?: SourceItem[];
  plan?: LessonPlan | null;
  error?: string | null;
  retryPrompt?: string;
}

interface ChatPanelProps {
  messages: ChatMessage[];
  settings: ChatSettings;
  onUpdateSettings: (patch: Partial<ChatSettings>) => void;
  selectedSourcesCount: number;
  isStreaming: boolean;
  onSendMessage: (text: string) => void;
  onRetryMessage: (messageId: string, promptText: string) => void;
  onSelectCitation: (target: ActiveCitationTarget) => void;
  onUploadFiles: (files: FileList | File[]) => Promise<void>;
  onOpenStudio?: () => void;
  initialDraft?: string;
  onInitialDraftConsumed?: () => void;
}

const LEVEL_OPTIONS = [
  { label: 'Beginner', value: 'beginner' },
  { label: 'Intermediate', value: 'intermediate' },
  { label: 'Advanced', value: 'advanced' },
];

const DURATION_OPTIONS = [
  { label: '30 min', value: 30 },
  { label: '45 min', value: 45 },
  { label: '60 min', value: 60 },
  { label: '90 min', value: 90 },
  { label: '120 min', value: 120 },
];

const AUDIENCE_OPTIONS = [
  { label: 'All', value: 'All' },
  { label: 'University students', value: 'university students' },
  { label: 'High school', value: 'high school students' },
  { label: 'Engineers', value: 'software engineers' },
  { label: 'Professionals', value: 'working professionals' },
];

const SUGGESTION_CARDS = [
  {
    title: 'Plan a new lesson',
    prompt: 'Plan a new lesson on prompt engineering fundamentals',
  },
  {
    title: 'Build a quiz from my sources',
    prompt: 'Build a quiz from my sources',
  },
  {
    title: 'Adapt an existing lesson',
    prompt: 'Adapt an existing lesson with hands-on prompting exercises',
  },
];

export const ChatPanel: React.FC<ChatPanelProps> = ({
  messages,
  settings,
  onUpdateSettings,
  selectedSourcesCount,
  isStreaming,
  onSendMessage,
  onRetryMessage,
  onSelectCitation,
  onUploadFiles,
  onOpenStudio,
  initialDraft,
  onInitialDraftConsumed,
}) => {
  const [input, setInput] = useState(initialDraft || '');
  const [openMenu, setOpenMenu] = useState<
    'level' | 'duration' | 'audience' | null
  >(null);
  const [showObjectivesInput, setShowObjectivesInput] = useState(false);
  const [objectiveDraft, setObjectiveDraft] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const menuContainerRef = useRef<HTMLDivElement>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (initialDraft) {
      setInput(initialDraft);
      onInitialDraftConsumed?.();
      setTimeout(() => {
        composerTextareaRef.current?.focus();
      }, 20);
    }
  }, [initialDraft, onInitialDraftConsumed]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!openMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuContainerRef.current &&
        !menuContainerRef.current.contains(e.target as Node)
      ) {
        setOpenMenu(null);
      }
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, [openMenu]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    setInput('');
    onSendMessage(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleAddObjective = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = objectiveDraft.trim();
    if (!trimmed) return;
    onUpdateSettings({
      objectives: [...settings.objectives, trimmed],
    });
    setObjectiveDraft('');
  };

  const handleRemoveObjective = (index: number) => {
    onUpdateSettings({
      objectives: settings.objectives.filter((_, i) => i !== index),
    });
  };

  const currentLevelLabel =
    LEVEL_OPTIONS.find(
      (o) => o.value.toLowerCase() === settings.level.toLowerCase()
    )?.label ||
    settings.level.charAt(0).toUpperCase() + settings.level.slice(1);

  const currentAudienceLabel =
    AUDIENCE_OPTIONS.find(
      (o) => o.value.toLowerCase() === settings.audience.toLowerCase()
    )?.label || settings.audience;

  return (
    <section className="flex-1 w-full min-w-0 flex flex-col p-4 sm:p-6 rounded-panel bg-surface border border-border relative overflow-hidden justify-between h-full">
      {/* Hidden file input for composer attach button */}
      <input
        ref={attachInputRef}
        type="file"
        accept=".pdf,.md,.txt"
        multiple
        onChange={async (e) => {
          if (e.target.files && e.target.files.length > 0) {
            await onUploadFiles(e.target.files);
            e.target.value = '';
          }
        }}
        className="hidden"
      />

      <div className="w-full max-w-[720px] mx-auto flex flex-col justify-between h-full min-h-0 min-w-0">
        {messages.length === 0 ? (
          /* Welcome Hero Section matching screen.png & code.html */
          <div className="flex flex-col items-center text-center mt-auto mb-auto px-2 sm:px-4 overflow-y-auto no-scrollbar py-4 min-w-0">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3 bg-surface-muted border border-border text-ink-muted flex-shrink-0">
              <span className="material-symbols-outlined text-[20px]">
                school
              </span>
            </div>
            <h1 className="text-[24px] sm:text-[28px] font-semibold tracking-tight text-ink break-words">
              What are we teaching?
            </h1>
            <p className="text-[14px] sm:text-[15px] leading-relaxed text-ink-muted mt-2 max-w-[460px] break-words">
              Add your sources, then describe your class. I'll build a cited
              lesson plan from them.
            </p>

            {/* 3 Suggestion Cards (Full titles without truncation) */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full mt-7 min-w-0">
              {SUGGESTION_CARDS.map((card) => (
                <button
                  key={card.title}
                  type="button"
                  disabled={isStreaming}
                  onClick={() => onSendMessage(card.prompt)}
                  className="flex items-center justify-between p-3.5 sm:p-4 rounded-xl bg-surface border border-border hover:border-border-strong text-left transition-colors group disabled:opacity-60 min-w-0"
                >
                  <span className="text-[13px] font-medium text-ink break-words min-w-0">
                    {card.title}
                  </span>
                  <span className="material-symbols-outlined text-[16px] text-ink-muted group-hover:text-ink group-hover:translate-x-0.5 transition-all ml-2 flex-shrink-0">
                    arrow_forward
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* Conversation Thread */
          <div className="flex-1 overflow-y-auto overflow-x-hidden thin-scrollbar pr-1 py-2 space-y-5 min-h-0 min-w-0">
            {messages.map((msg) => {
              if (msg.role === 'user') {
                return (
                  <div key={msg.id} className="flex justify-end min-w-0">
                    <div className="max-w-[85%] sm:max-w-[75%] rounded-2xl rounded-tr-sm bg-surface-muted border border-border px-4 py-2.5 text-[14px] text-ink leading-relaxed break-words">
                      {msg.content}
                    </div>
                  </div>
                );
              }

              // Assistant turn (left-aligned plain text + status steps + citations)
              const steps = msg.statusSteps || [];
              return (
                <div key={msg.id} className="flex flex-col items-start gap-2 min-w-0">
                  {/* Status steps ("Searching sources" -> "Reading N passages" -> "Drafting plan") */}
                  {(msg.isStreaming || steps.length > 0) && (
                    <div className="flex flex-wrap items-center gap-1.5 text-[12px] min-w-0">
                      {steps.map((step, idx) => {
                        const isLatest =
                          msg.isStreaming && idx === steps.length - 1;
                        return (
                          <React.Fragment key={`${step}-${idx}`}>
                            {idx > 0 && (
                              <span className="text-ink-subtle text-[11px]">
                                →
                              </span>
                            )}
                            <span
                              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[11px] font-medium ${
                                isLatest
                                  ? 'bg-accent-soft text-accent border-accent/30'
                                  : 'bg-surface-muted text-ink-muted border-border'
                              }`}
                            >
                              {isLatest ? (
                                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                              ) : (
                                <span className="material-symbols-outlined text-[12px] text-accent">
                                  check
                                </span>
                              )}
                              <span className="break-words">{step}</span>
                            </span>
                          </React.Fragment>
                        );
                      })}
                    </div>
                  )}

                  {/* Streamed plain text on the left with clickable [n] citation chips */}
                  {msg.content ? (
                    <div className="text-[14px] sm:text-[15px] leading-relaxed text-ink whitespace-pre-wrap break-words max-w-full min-w-0">
                      <CitationText
                        text={msg.content}
                        sources={msg.sources}
                        citations={msg.plan?.citations}
                        onSelectCitation={onSelectCitation}
                      />
                      {msg.isStreaming && (
                        <span className="inline-block w-1.5 h-4 ml-1 align-middle bg-accent animate-pulse" />
                      )}
                    </div>
                  ) : msg.isStreaming && !msg.error ? (
                    <div className="flex items-center gap-2 text-[13px] text-ink-muted py-1">
                      <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
                      <span>
                        {msg.currentStatus || 'Preparing lesson plan...'}
                      </span>
                    </div>
                  ) : null}

                  {/* Compact card when a LessonPlan was generated/updated in this turn */}
                  {msg.plan && (
                    <div className="mt-1 w-full sm:w-auto max-w-full inline-flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-surface-muted border border-border flex-wrap">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-7 h-7 rounded-lg bg-accent-soft text-accent flex items-center justify-center flex-shrink-0">
                          <span className="material-symbols-outlined text-[16px]">
                            description
                          </span>
                        </div>
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold text-ink break-words">
                            {msg.plan.title}
                          </p>
                          <p className="text-[11px] text-ink-muted">
                            {msg.plan.duration_min} min ·{' '}
                            {msg.plan.outline.length} sections ·{' '}
                            {msg.plan.citations.length} citations
                          </p>
                        </div>
                      </div>
                      {onOpenStudio && (
                        <button
                          type="button"
                          onClick={onOpenStudio}
                          className="px-2.5 py-1 rounded-full bg-surface border border-border hover:border-border-strong text-[12px] font-medium text-ink transition-colors flex-shrink-0"
                        >
                          Open in Studio
                        </button>
                      )}
                    </div>
                  )}

                  {/* Error State ("Couldn't reach the server. Retry") */}
                  {msg.error && (
                    <div className="mt-1 p-3.5 rounded-xl bg-danger-soft border border-danger-border flex flex-col sm:flex-row sm:items-center justify-between gap-3 w-full max-w-md">
                      <div className="flex items-start gap-2">
                        <span className="material-symbols-outlined text-[18px] text-danger mt-0.5">
                          error
                        </span>
                        <div>
                          <p className="text-[13px] font-medium text-ink">
                            Couldn't reach the server. Retry
                          </p>
                          {msg.error !== "Couldn't reach the server. Retry" && (
                            <p className="text-[12px] text-ink-muted mt-0.5">
                              {msg.error}
                            </p>
                          )}
                        </div>
                      </div>
                      {msg.retryPrompt && (
                        <button
                          type="button"
                          onClick={() =>
                            onRetryMessage(msg.id, msg.retryPrompt!)
                          }
                          className="px-3 py-1.5 rounded-full bg-accent hover:bg-accent-hover text-white text-[12px] font-medium transition-colors self-start sm:self-center flex-shrink-0"
                        >
                          Retry
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}

        {/* Bottom Composer Section */}
        <div className="w-full flex flex-col gap-2 mt-auto pt-2 flex-shrink-0">
          {/* Parameter Chips Row (Level, Duration, Audience) */}
          <div
            ref={menuContainerRef}
            className="flex items-center gap-2 flex-wrap relative"
          >
            {/* Level Pill */}
            <div className="relative">
              <button
                type="button"
                onClick={() =>
                  setOpenMenu((m) => (m === 'level' ? null : 'level'))
                }
                className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-muted border border-border hover:border-border-strong text-[12px] font-medium text-ink-muted hover:text-ink transition-colors"
              >
                <span>Level: {currentLevelLabel}</span>
                <span className="material-symbols-outlined text-[13px]">
                  expand_more
                </span>
              </button>

              {openMenu === 'level' && (
                <div className="absolute bottom-full left-0 mb-1.5 w-40 rounded-xl bg-surface border border-border py-1 z-40">
                  {LEVEL_OPTIONS.map((opt) => {
                    const active =
                      settings.level.toLowerCase() === opt.value.toLowerCase();
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => {
                          onUpdateSettings({ level: opt.value });
                          setOpenMenu(null);
                        }}
                        className={`w-full text-left px-3 py-1.5 text-[12px] hover:bg-surface-muted flex items-center justify-between ${
                          active ? 'text-accent font-semibold' : 'text-ink'
                        }`}
                      >
                        <span>{opt.label}</span>
                        {active && (
                          <span className="material-symbols-outlined text-[14px]">
                            check
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Duration Pill */}
            <div className="relative">
              <button
                type="button"
                onClick={() =>
                  setOpenMenu((m) => (m === 'duration' ? null : 'duration'))
                }
                className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-muted border border-border hover:border-border-strong text-[12px] font-medium text-ink-muted hover:text-ink transition-colors"
              >
                <span>Duration: {settings.duration_min} min</span>
                <span className="material-symbols-outlined text-[13px]">
                  expand_more
                </span>
              </button>

              {openMenu === 'duration' && (
                <div className="absolute bottom-full left-0 mb-1.5 w-36 rounded-xl bg-surface border border-border py-1 z-40">
                  {DURATION_OPTIONS.map((opt) => {
                    const active = settings.duration_min === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => {
                          onUpdateSettings({ duration_min: opt.value });
                          setOpenMenu(null);
                        }}
                        className={`w-full text-left px-3 py-1.5 text-[12px] hover:bg-surface-muted flex items-center justify-between ${
                          active ? 'text-accent font-semibold' : 'text-ink'
                        }`}
                      >
                        <span>{opt.label}</span>
                        {active && (
                          <span className="material-symbols-outlined text-[14px]">
                            check
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Audience Pill */}
            <div className="relative">
              <button
                type="button"
                onClick={() =>
                  setOpenMenu((m) => (m === 'audience' ? null : 'audience'))
                }
                className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-muted border border-border hover:border-border-strong text-[12px] font-medium text-ink-muted hover:text-ink transition-colors"
              >
                <span>Audience: {currentAudienceLabel}</span>
                <span className="material-symbols-outlined text-[13px]">
                  expand_more
                </span>
              </button>

              {openMenu === 'audience' && (
                <div className="absolute bottom-full left-0 mb-1.5 w-48 rounded-xl bg-surface border border-border py-1 z-40">
                  {AUDIENCE_OPTIONS.map((opt) => {
                    const active =
                      settings.audience.toLowerCase() ===
                      opt.value.toLowerCase();
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => {
                          onUpdateSettings({ audience: opt.value });
                          setOpenMenu(null);
                        }}
                        className={`w-full text-left px-3 py-1.5 text-[12px] hover:bg-surface-muted flex items-center justify-between ${
                          active ? 'text-accent font-semibold' : 'text-ink'
                        }`}
                      >
                        <span>{opt.label}</span>
                        {active && (
                          <span className="material-symbols-outlined text-[14px]">
                            check
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Active custom objectives pills */}
            {settings.objectives.map((obj, idx) => (
              <span
                key={`${obj}-${idx}`}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-accent-soft text-accent border border-accent/25 text-[11px] font-medium"
              >
                <span className="truncate max-w-[160px]">{obj}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveObjective(idx)}
                  className="hover:text-accent-hover"
                >
                  <span className="material-symbols-outlined text-[13px]">
                    close
                  </span>
                </button>
              </span>
            ))}
          </div>

          {/* Optional Objectives drawer toggled by the 'tune' icon */}
          {showObjectivesInput && (
            <form
              onSubmit={handleAddObjective}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-muted border border-border"
            >
              <span className="text-[12px] font-medium text-ink-muted flex-shrink-0">
                Add objective:
              </span>
              <input
                type="text"
                value={objectiveDraft}
                onChange={(e) => setObjectiveDraft(e.target.value)}
                placeholder="e.g. Compare zero-shot vs few-shot accuracy"
                className="flex-1 bg-transparent border-0 text-[12px] text-ink placeholder-ink-muted focus:outline-none"
              />
              <button
                type="submit"
                className="px-2.5 py-1 rounded-full bg-accent text-white text-[11px] font-medium hover:bg-accent-hover transition-colors"
              >
                Add
              </button>
            </form>
          )}

          {/* Floating Composer Container */}
          <div className="rounded-panel bg-surface border border-border p-3.5 focus-within:border-accent transition-colors flex flex-col gap-2">
            <div className="flex items-start gap-2.5">
              <button
                type="button"
                aria-label="Prompt Parameters"
                title="Add custom learning objectives"
                onClick={() => setShowObjectivesInput((v) => !v)}
                className={`p-1 rounded-md transition-colors mt-0.5 ${
                  showObjectivesInput
                    ? 'text-accent bg-accent-soft'
                    : 'text-ink-muted hover:text-ink hover:bg-surface-muted'
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">
                  tune
                </span>
              </button>

              <textarea
                ref={composerTextareaRef}
                rows={2}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask a question or describe your class..."
                className="w-full bg-transparent border-0 text-[14px] text-ink placeholder-ink-muted focus:outline-none resize-none leading-relaxed p-0"
              />
            </div>

            {/* Bottom Toolbar inside composer */}
            <div className="flex items-center justify-between pt-2 border-t border-border/80">
              <div className="flex items-center">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-surface-chip text-[12px] font-medium text-ink-muted">
                  {selectedSourcesCount}{' '}
                  {selectedSourcesCount === 1 ? 'source' : 'sources'}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label="Attach File"
                  title="Upload source file (.pdf, .md, .txt)"
                  onClick={() => attachInputRef.current?.click()}
                  className="w-7 h-7 rounded-full flex items-center justify-center text-ink-muted hover:text-ink hover:bg-surface-muted transition-colors"
                >
                  <span className="material-symbols-outlined text-[18px]">
                    attach_file
                  </span>
                </button>

                <button
                  type="button"
                  aria-label="Send message"
                  disabled={!input.trim() || isStreaming}
                  onClick={handleSend}
                  className="w-7 h-7 rounded-full bg-accent hover:bg-accent-hover disabled:opacity-50 text-white flex items-center justify-center transition-colors"
                >
                  <span className="material-symbols-outlined text-[15px]">
                    arrow_upward
                  </span>
                </button>
              </div>
            </div>
          </div>

          {/* Disclaimer */}
          <p className="text-center text-[12px] text-ink-muted mt-1">
            Lessonwright can make mistakes, so double-check against the sources.
          </p>
        </div>
      </div>
    </section>
  );
};

