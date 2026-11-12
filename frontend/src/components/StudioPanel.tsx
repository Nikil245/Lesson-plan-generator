import React, { useEffect, useState } from 'react';
import {
  LessonPlan,
  lessonPlanToMarkdown,
  OutlineActivityType,
  SourceItem,
} from '../api/client';
import { ActiveCitationTarget, CitationText } from './CitationText';

interface StudioPanelProps {
  plan: LessonPlan | null;
  sources: SourceItem[];
  isStreaming: boolean;
  currentStatus: string | null;
  onSendQuickAction: (message: string) => void;
  onSelectCitation: (target: ActiveCitationTarget) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

const QUICK_ACTIONS = ['Make it more hands-on', 'Add a quiz', 'Simplify'];

const STUDIO_TOOLS = [
  { id: 'lesson-plan', label: 'Lesson plan', icon: 'description', prompt: 'Plan a new lesson' },
  { id: 'quiz', label: 'Quiz', icon: 'fact_check', prompt: 'Add a quiz' },
  { id: 'slides', label: 'Slide outline', icon: 'co_present', prompt: 'Create a slide-by-slide outline for this lesson' },
  { id: 'worksheet', label: 'Worksheet', icon: 'edit', prompt: 'Make it more hands-on' },
  { id: 'flashcards', label: 'Flashcards', icon: 'style', prompt: 'What are the key concepts and definitions to review?' },
  { id: 'rubric', label: 'Rubric', icon: 'table_chart', prompt: 'Expand the assessment section with a grading rubric' },
  { id: 'mindmap', label: 'Mind map', icon: 'account_tree', prompt: 'Summarize how the core concepts in this lesson connect' },
  { id: 'export', label: 'Export', icon: 'ios_share', prompt: '' },
];

function activityBadgeStyle(type: OutlineActivityType): {
  className: string;
  icon: string;
  label: string;
} {
  switch (type) {
    case 'hands-on':
      return {
        className: 'bg-accent-soft text-accent border-accent/30',
        icon: 'terminal',
        label: 'hands-on',
      };
    case 'demo':
      return {
        className: 'bg-surface-muted text-ink border-border',
        icon: 'play_circle',
        label: 'demo',
      };
    case 'discuss':
    default:
      return {
        className: 'bg-surface-chip text-ink-muted border-border',
        icon: 'forum',
        label: 'discuss',
      };
  }
}

export const StudioPanel: React.FC<StudioPanelProps> = ({
  plan,
  sources,
  isStreaming,
  currentStatus,
  onSendQuickAction,
  onSelectCitation,
  isCollapsed,
  onToggleCollapse,
}) => {
  const [checkedObjectives, setCheckedObjectives] = useState<Record<number, boolean>>({});
  const [copiedPromptIdx, setCopiedPromptIdx] = useState<number | null>(null);
  const [showToolsGrid, setShowToolsGrid] = useState(false);

  // Whenever a new plan arrives, switch automatically to the document view
  useEffect(() => {
    if (plan) {
      setShowToolsGrid(false);
      setCheckedObjectives({});
    }
  }, [plan]);

  const handleExportMarkdown = () => {
    if (!plan) return;
    const markdown = lessonPlanToMarkdown(plan);
    const slug =
      plan.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'lesson-plan';
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopyPrompt = async (promptText: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(promptText);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = promptText;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopiedPromptIdx(idx);
    setTimeout(() => {
      setCopiedPromptIdx((curr) => (curr === idx ? null : curr));
    }, 2000);
  };

  // Collapsed desktop rail view
  if (isCollapsed) {
    return (
      <aside className="hidden lg:flex w-14 flex-shrink-0 flex-col items-center justify-between py-5 px-2 rounded-panel bg-surface border border-border select-none">
        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Expand Studio panel"
            title="Expand Studio"
            className="w-8 h-8 rounded-md flex items-center justify-center text-ink-muted hover:text-ink hover:bg-surface-muted border border-transparent hover:border-border transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">
              dock_to_right
            </span>
          </button>

          {plan && (
            <button
              type="button"
              onClick={handleExportMarkdown}
              title="Export Markdown"
              aria-label="Export Markdown"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-accent bg-accent-soft hover:bg-accent hover:text-white transition-colors"
            >
              <span className="material-symbols-outlined text-[17px]">
                download
              </span>
            </button>
          )}
        </div>

        <div className="flex flex-col items-center gap-2">
          <span
            title={plan ? `Plan ready: ${plan.title}` : 'No lesson plan yet'}
            className={`w-2.5 h-2.5 rounded-full ${
              plan ? 'bg-accent' : 'bg-border'
            }`}
          />
        </div>
      </aside>
    );
  }

  return (
    <aside
      className={`w-full ${
        plan && !showToolsGrid
          ? 'lg:w-[400px] xl:w-[460px]'
          : 'lg:w-[360px]'
      } flex-shrink-0 flex flex-col p-6 rounded-panel bg-surface border border-border justify-between overflow-hidden h-full transition-all`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-shrink-0 select-none">
        <div className="flex items-center gap-2">
          <span className="text-[18px] font-semibold text-ink tracking-tight">
            Studio
          </span>
          {plan && (
            <button
              type="button"
              onClick={() => setShowToolsGrid((v) => !v)}
              className="px-2 py-0.5 rounded-full bg-surface-muted border border-border text-[11px] font-medium text-ink-muted hover:text-ink transition-colors"
            >
              {showToolsGrid ? 'View plan' : 'Tools'}
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {plan && (
            <button
              type="button"
              onClick={handleExportMarkdown}
              title="Download lesson plan as Markdown (.md)"
              className="px-3 py-1 rounded-full bg-surface-muted hover:bg-surface-hover border border-border text-[12px] font-medium text-ink flex items-center gap-1.5 transition-colors"
            >
              <span className="material-symbols-outlined text-[15px] text-ink-muted">
                download
              </span>
              <span>Export .md</span>
            </button>
          )}

          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Collapse panel"
            title="Collapse Studio panel"
            className="hidden lg:flex w-7 h-7 rounded-md items-center justify-center text-ink-muted hover:text-ink hover:bg-surface-muted transition-colors border border-transparent hover:border-border"
          >
            <span className="material-symbols-outlined text-[18px]">
              dock_to_right
            </span>
          </button>
        </div>
      </div>

      {/* Empty State / Studio Tools Grid (matches screen.png & code.html) */}
      {!plan || showToolsGrid ? (
        <div className="flex-1 flex flex-col justify-between min-h-0 select-none">
          <div className="grid grid-cols-2 gap-2.5">
            {STUDIO_TOOLS.map((tool) => (
              <button
                key={tool.id}
                type="button"
                disabled={isStreaming && tool.id !== 'export'}
                onClick={() => {
                  if (tool.id === 'export') {
                    if (plan) handleExportMarkdown();
                    return;
                  }
                  if (tool.id === 'lesson-plan' && plan) {
                    setShowToolsGrid(false);
                    return;
                  }
                  if (tool.prompt) {
                    onSendQuickAction(tool.prompt);
                    setShowToolsGrid(false);
                  }
                }}
                className="flex items-center gap-3 p-3.5 rounded-tile bg-surface border border-border hover:bg-surface-muted cursor-pointer transition-colors text-left disabled:opacity-60"
              >
                <span className="material-symbols-outlined text-[18px] text-ink-muted">
                  {tool.icon}
                </span>
                <span className="text-[14px] font-medium text-ink">
                  {tool.label}
                </span>
              </button>
            ))}
          </div>

          {/* Bottom Empty / Loading State */}
          <div className="flex flex-col items-center justify-center p-5 rounded-xl border border-dashed border-border bg-surface-muted/60 text-center mt-4">
            {isStreaming ? (
              <>
                <div className="w-6 h-6 rounded-full border-2 border-border border-t-accent animate-spin mb-2" />
                <p className="text-[12px] font-medium text-ink">
                  {currentStatus || 'Drafting lesson plan...'}
                </p>
                <p className="text-[11px] text-ink-muted mt-0.5">
                  Your structured plan will appear here
                </p>
              </>
            ) : plan ? (
              <>
                <span className="material-symbols-outlined text-[20px] text-accent mb-1.5">
                  check_circle
                </span>
                <p className="text-[12px] font-medium text-ink mb-2">
                  {plan.title}
                </p>
                <button
                  type="button"
                  onClick={() => setShowToolsGrid(false)}
                  className="px-3 py-1 rounded-full bg-accent text-white text-[12px] font-medium hover:bg-accent-hover transition-colors"
                >
                  Return to lesson plan
                </button>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[20px] text-ink-muted mb-2">
                  auto_fix_high
                </span>
                <p className="text-[12px] text-ink-muted">
                  Generated lessons will be saved here.
                </p>
              </>
            )}
          </div>
        </div>
      ) : (
        /* Rendered LessonPlan Document */
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Quick-action refinement pills ("Make it more hands-on", "Add a quiz", "Simplify") */}
          <div className="flex items-center gap-1.5 flex-wrap pb-3 mb-3 border-b border-border flex-shrink-0">
            {QUICK_ACTIONS.map((actionText) => (
              <button
                key={actionText}
                type="button"
                disabled={isStreaming}
                onClick={() => onSendQuickAction(actionText)}
                className="px-2.5 py-1 rounded-full bg-surface-muted hover:bg-accent-soft hover:text-accent hover:border-accent/30 border border-border text-[12px] font-medium text-ink-muted transition-colors disabled:opacity-50"
              >
                {actionText}
              </button>
            ))}
          </div>

          {/* Scrollable Lesson Plan Document */}
          <div className="flex-1 overflow-y-auto thin-scrollbar pr-1 space-y-6 select-text">
            {/* 1. Title & Meta Pills */}
            <div>
              <h2 className="text-[20px] font-semibold text-ink tracking-tight leading-snug">
                {plan.title}
              </h2>
              <div className="flex items-center flex-wrap gap-1.5 mt-2.5">
                {plan.level && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-accent-soft text-accent border border-accent/25 text-[11px] font-medium capitalize">
                    <span className="material-symbols-outlined text-[13px]">
                      signal_cellular_alt
                    </span>
                    <span>{plan.level}</span>
                  </span>
                )}
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-surface-muted text-ink-muted border border-border text-[11px] font-medium">
                  <span className="material-symbols-outlined text-[13px]">
                    schedule
                  </span>
                  <span>{plan.duration_min} min</span>
                </span>
                {plan.audience && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-surface-muted text-ink-muted border border-border text-[11px] font-medium">
                    <span className="material-symbols-outlined text-[13px]">
                      groups
                    </span>
                    <span>{plan.audience}</span>
                  </span>
                )}
              </div>
            </div>

            {/* 2. Objectives Checklist */}
            {plan.objectives && plan.objectives.length > 0 && (
              <section>
                <h3 className="text-[12px] font-semibold uppercase tracking-wider text-ink-muted mb-2.5">
                  Learning Objectives
                </h3>
                <div className="space-y-2">
                  {plan.objectives.map((objective, idx) => {
                    const checked = !!checkedObjectives[idx];
                    return (
                      <label
                        key={idx}
                        className="flex items-start gap-2.5 p-2.5 rounded-xl bg-surface-muted/70 border border-border cursor-pointer hover:border-border-strong transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setCheckedObjectives((prev) => ({
                              ...prev,
                              [idx]: !prev[idx],
                            }))
                          }
                          className="mt-0.5 w-4 h-4 rounded border-border text-accent focus:ring-0 focus:ring-offset-0 cursor-pointer accent-[#0D9488] flex-shrink-0"
                        />
                        <span
                          className={`text-[13px] leading-relaxed ${
                            checked ? 'line-through text-ink-muted' : 'text-ink'
                          }`}
                        >
                          <CitationText
                            text={objective}
                            sources={sources}
                            citations={plan.citations}
                            onSelectCitation={onSelectCitation}
                          />
                        </span>
                      </label>
                    );
                  })}
                </div>
              </section>
            )}

            {/* 3. Prerequisites (if present) */}
            {plan.prerequisites && plan.prerequisites.length > 0 && (
              <section>
                <h3 className="text-[12px] font-semibold uppercase tracking-wider text-ink-muted mb-2">
                  Prerequisites
                </h3>
                <ul className="space-y-1.5 pl-4 list-disc text-[13px] text-ink marker:text-ink-subtle">
                  {plan.prerequisites.map((item, idx) => (
                    <li key={idx} className="leading-relaxed">
                      <CitationText
                        text={item}
                        sources={sources}
                        citations={plan.citations}
                        onSelectCitation={onSelectCitation}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* 4. Timed Outline Timeline */}
            {plan.outline && plan.outline.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-[12px] font-semibold uppercase tracking-wider text-ink-muted">
                    Timed Outline
                  </h3>
                  <span className="text-[11px] text-ink-muted">
                    {plan.outline.length} blocks · {plan.duration_min} min total
                  </span>
                </div>

                <div className="relative pl-4 border-l border-border space-y-4">
                  {plan.outline.map((item, idx) => {
                    const badge = activityBadgeStyle(item.type);
                    const duration = item.end_min - item.start_min;
                    const isCopied = copiedPromptIdx === idx;

                    return (
                      <div key={idx} className="relative group">
                        {/* Timeline dot */}
                        <span className="absolute -left-[21px] top-3 w-2.5 h-2.5 rounded-full bg-surface border-2 border-accent" />

                        <div className="p-3.5 rounded-xl bg-surface border border-border hover:border-border-strong transition-colors space-y-2">
                          {/* Top row: time range + demo/discuss/hands-on pill */}
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span className="font-mono text-[11px] font-medium text-ink-muted">
                              {item.start_min}–{item.end_min} min ({duration}m)
                            </span>
                            <span
                              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border text-[11px] font-medium ${badge.className}`}
                            >
                              <span className="material-symbols-outlined text-[13px]">
                                {badge.icon}
                              </span>
                              <span>{badge.label}</span>
                            </span>
                          </div>

                          {/* Block Title */}
                          <h4 className="text-[14px] font-semibold text-ink leading-snug">
                            {item.title}
                          </h4>

                          {/* Description with clickable [n] citations */}
                          <p className="text-[13px] text-ink leading-relaxed">
                            <CitationText
                              text={item.description}
                              sources={sources}
                              citations={plan.citations}
                              onSelectCitation={onSelectCitation}
                            />
                          </p>

                          {/* Example Prompt in a code block with Copy button */}
                          {item.example_prompt && (
                            <div className="mt-2 rounded-lg bg-surface-code border border-border overflow-hidden">
                              <div className="flex items-center justify-between px-3 py-1.5 bg-surface-muted border-b border-border">
                                <span className="text-[11px] font-medium text-ink-muted font-mono">
                                  Example prompt
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleCopyPrompt(item.example_prompt!, idx)
                                  }
                                  className="inline-flex items-center gap-1 text-[11px] font-medium text-ink-muted hover:text-accent transition-colors"
                                >
                                  <span className="material-symbols-outlined text-[13px]">
                                    {isCopied ? 'check' : 'content_copy'}
                                  </span>
                                  <span>{isCopied ? 'Copied' : 'Copy'}</span>
                                </button>
                              </div>
                              <pre className="p-3 font-mono text-code text-ink whitespace-pre-wrap break-words overflow-x-auto m-0">
                                {item.example_prompt}
                              </pre>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* 5. Assessment */}
            {plan.assessment && plan.assessment.length > 0 && (
              <section>
                <h3 className="text-[12px] font-semibold uppercase tracking-wider text-ink-muted mb-2.5">
                  Assessment
                </h3>
                <ul className="space-y-2">
                  {plan.assessment.map((item, idx) => (
                    <li
                      key={idx}
                      className="flex items-start gap-2 p-2.5 rounded-xl bg-surface-muted/60 border border-border text-[13px] text-ink leading-relaxed"
                    >
                      <span className="material-symbols-outlined text-[16px] text-accent mt-0.5 flex-shrink-0">
                        fact_check
                      </span>
                      <span>
                        <CitationText
                          text={item}
                          sources={sources}
                          citations={plan.citations}
                          onSelectCitation={onSelectCitation}
                        />
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* 6. Further Reading */}
            {plan.further_reading && plan.further_reading.length > 0 && (
              <section>
                <h3 className="text-[12px] font-semibold uppercase tracking-wider text-ink-muted mb-2">
                  Further Reading
                </h3>
                <ul className="space-y-1.5">
                  {plan.further_reading.map((item, idx) => (
                    <li
                      key={idx}
                      className="flex items-start gap-2 text-[13px] text-ink leading-relaxed"
                    >
                      <span className="material-symbols-outlined text-[16px] text-ink-muted mt-0.5 flex-shrink-0">
                        menu_book
                      </span>
                      <span>
                        <CitationText
                          text={item}
                          sources={sources}
                          citations={plan.citations}
                          onSelectCitation={onSelectCitation}
                        />
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* 7. Citations */}
            {plan.citations && plan.citations.length > 0 && (
              <section className="pt-2 border-t border-border">
                <h3 className="text-[12px] font-semibold uppercase tracking-wider text-ink-muted mb-2.5">
                  Citations ({plan.citations.length})
                </h3>
                <div className="space-y-1.5">
                  {plan.citations.map((cite) => {
                    const matchedSource = sources.find((s) => s.n === cite.n);
                    return (
                      <div
                        key={cite.n}
                        onClick={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          onSelectCitation({
                            n: cite.n,
                            sourceId: cite.source_id,
                            title: cite.title,
                            page: cite.page,
                            url: cite.url,
                            excerpt: matchedSource?.excerpt,
                            anchorRect: {
                              top: rect.top,
                              left: rect.left,
                              bottom: rect.bottom,
                              width: rect.width,
                            },
                          });
                        }}
                        className="flex items-start justify-between gap-2 p-2 rounded-lg bg-surface-muted hover:bg-accent-soft/50 border border-border cursor-pointer transition-colors"
                      >
                        <div className="flex items-start gap-2 min-w-0">
                          <span className="inline-flex items-center justify-center min-w-[20px] h-[19px] px-1.5 rounded-full bg-accent text-white text-[11px] font-semibold flex-shrink-0 mt-0.5">
                            {cite.n}
                          </span>
                          <div className="min-w-0">
                            <p className="text-[12px] font-medium text-ink truncate">
                              {cite.title}
                            </p>
                            <p className="text-[11px] text-ink-muted">
                              Page {cite.page}
                            </p>
                          </div>
                        </div>

                        {cite.url && (
                          <a
                            href={cite.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            title="Open external link"
                            className="text-accent hover:text-accent-hover p-1 flex-shrink-0"
                          >
                            <span className="material-symbols-outlined text-[15px]">
                              open_in_new
                            </span>
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        </div>
      )}
    </aside>
  );
};

