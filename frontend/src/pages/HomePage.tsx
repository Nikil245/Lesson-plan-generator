import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { API_BASE_URL, createSessionId, fetchSources } from '../api/client';
import * as lessonStore from '../lib/lessons';
import { LessonRecord } from '../lib/lessons';

type FilterTab = 'all' | 'mine';
type ViewMode = 'grid' | 'list';
type SortOption = 'recent' | 'title';

interface TemplateItem {
  id: string;
  title: string;
  level: 'beginner' | 'intermediate' | 'advanced';
  levelLabel: 'Beginner' | 'Intermediate' | 'Advanced';
  durationMin: number;
  defaultSourceCount: number;
  icon: string;
  bgTintStyle: string;
  iconColorClass: string;
  starterPrompt: string;
}

const TEMPLATES: TemplateItem[] = [
  {
    id: 'few-shot-workshop',
    title: 'Few-shot prompting workshop',
    level: 'beginner',
    levelLabel: 'Beginner',
    durationMin: 60,
    defaultSourceCount: 4,
    icon: 'format_list_numbered',
    bgTintStyle: 'rgba(13, 148, 136, 0.12)', // teal ~12%
    iconColorClass: 'text-[#0D9488]',
    starterPrompt: 'Plan a 60-minute beginner lesson on few-shot prompting',
  },
  {
    id: 'cot-reasoning',
    title: 'Chain-of-thought for reasoning',
    level: 'intermediate',
    levelLabel: 'Intermediate',
    durationMin: 45,
    defaultSourceCount: 4,
    icon: 'account_tree',
    bgTintStyle: 'rgba(37, 99, 235, 0.11)', // blue ~12%
    iconColorClass: 'text-[#2563EB]',
    starterPrompt:
      'Plan a 45-minute intermediate lesson on chain-of-thought reasoning',
  },
  {
    id: 'react-tool-use',
    title: 'ReAct and tool use',
    level: 'advanced',
    levelLabel: 'Advanced',
    durationMin: 60,
    defaultSourceCount: 5,
    icon: 'construction',
    bgTintStyle: 'rgba(217, 119, 6, 0.12)', // amber ~12%
    iconColorClass: 'text-[#B45309]',
    starterPrompt: 'Plan a 60-minute advanced lesson on ReAct and tool use',
  },
  {
    id: 'system-prompts-beginners',
    title: 'System prompts for beginners',
    level: 'beginner',
    levelLabel: 'Beginner',
    durationMin: 30,
    defaultSourceCount: 3,
    icon: 'tune',
    bgTintStyle: 'rgba(225, 29, 72, 0.11)', // rose ~12%
    iconColorClass: 'text-[#BE123C]',
    starterPrompt:
      'Plan a 30-minute beginner lesson on writing effective system prompts',
  },
  {
    id: 'prompt-injection-basics',
    title: 'Prompt injection basics',
    level: 'beginner',
    levelLabel: 'Beginner',
    durationMin: 45,
    defaultSourceCount: 4,
    icon: 'shield_lock',
    bgTintStyle: 'rgba(124, 58, 237, 0.11)', // violet ~12%
    iconColorClass: 'text-[#6D28D9]',
    starterPrompt:
      'Plan a 45-minute beginner lesson on prompt injection and security basics',
  },
  {
    id: 'evaluating-prompts',
    title: 'Evaluating prompts',
    level: 'intermediate',
    levelLabel: 'Intermediate',
    durationMin: 60,
    defaultSourceCount: 4,
    icon: 'fact_check',
    bgTintStyle: 'rgba(71, 85, 105, 0.12)', // slate ~12%
    iconColorClass: 'text-[#334155]',
    starterPrompt:
      'Plan a 60-minute intermediate lesson on evaluating and benchmarking prompts',
  },
];

const LESSON_ICON_TINTS = [
  {
    bg: 'rgba(13, 148, 136, 0.12)',
    textClass: 'text-[#0D9488]',
    icon: 'menu_book',
  },
  {
    bg: 'rgba(37, 99, 235, 0.12)',
    textClass: 'text-[#2563EB]',
    icon: 'school',
  },
  {
    bg: 'rgba(217, 119, 6, 0.12)',
    textClass: 'text-[#B45309]',
    icon: 'psychology',
  },
  {
    bg: 'rgba(124, 58, 237, 0.12)',
    textClass: 'text-[#6D28D9]',
    icon: 'auto_stories',
  },
  {
    bg: 'rgba(225, 29, 72, 0.11)',
    textClass: 'text-[#BE123C]',
    icon: 'description',
  },
  {
    bg: 'rgba(71, 85, 105, 0.12)',
    textClass: 'text-[#334155]',
    icon: 'terminal',
  },
];

function getLessonVisual(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return LESSON_ICON_TINTS[hash % LESSON_ICON_TINTS.length];
}

function formatLessonDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return 'Recent';
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(date);
  } catch {
    return 'Recent';
  }
}

function formatLevelLabel(level: string): string {
  if (!level) return 'Beginner';
  return level.charAt(0).toUpperCase() + level.slice(1).toLowerCase();
}

export const HomePage: React.FC = () => {
  const navigate = useNavigate();

  // Library state
  const [lessons, setLessons] = useState<LessonRecord[]>(() =>
    lessonStore.list()
  );
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [sortBy, setSortBy] = useState<SortOption>('recent');
  const [sortDropdownOpen, setSortDropdownOpen] = useState<boolean>(false);
  const [showAllTemplates, setShowAllTemplates] = useState<boolean>(false);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [indexedSourceCount, setIndexedSourceCount] = useState<number | null>(
    null
  );

  // Per-card three-dot menu & modal states
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [renamingLesson, setRenamingLesson] = useState<LessonRecord | null>(
    null
  );
  const [renameDraft, setRenameDraft] = useState<string>('');
  const [deletingLesson, setDeletingLesson] = useState<LessonRecord | null>(
    null
  );

  const templateRowRef = useRef<HTMLDivElement>(null);
  const sortMenuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Refresh lessons on mount
  useEffect(() => {
    setLessons(lessonStore.list());
  }, []);

  // Fetch indexed source count from backend if reachable
  useEffect(() => {
    let mounted = true;
    fetchSources()
      .then((list) => {
        if (mounted) {
          setIndexedSourceCount(list.length);
        }
      })
      .catch(() => {
        // Keep null fallback if backend isn't running
      });
    return () => {
      mounted = false;
    };
  }, []);

  // Close menus on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        sortMenuRef.current &&
        !sortMenuRef.current.contains(target)
      ) {
        setSortDropdownOpen(false);
      }
      if (!target.closest('[data-card-menu]')) {
        setOpenMenuId(null);
      }
    };
    window.addEventListener('mousedown', handleOutsideClick);
    return () => window.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // Focus rename input when modal opens
  useEffect(() => {
    if (renamingLesson) {
      setTimeout(() => {
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
      }, 20);
    }
  }, [renamingLesson]);

  const handleCreateNewLesson = () => {
    const id = createSessionId();
    lessonStore.createEmptyLesson({
      id,
      title: 'Untitled lesson',
      sourceCount: indexedSourceCount ?? 0,
    });
    navigate(`/lesson/${id}`);
  };

  const handleStartFromTemplate = (template: TemplateItem) => {
    const id = createSessionId();
    lessonStore.createEmptyLesson({
      id,
      title: template.title,
      sourceCount: indexedSourceCount ?? template.defaultSourceCount,
      settings: {
        level: template.level,
        duration_min: template.durationMin,
        audience: 'All',
        objectives: [],
        source_ids: null,
      },
      initialPrompt: template.starterPrompt,
    });
    navigate(`/lesson/${id}`, {
      state: { initialPrompt: template.starterPrompt },
    });
  };

  const handleOpenLesson = (lessonId: string) => {
    navigate(`/lesson/${lessonId}`);
  };

  const handleCardKeyDown = (
    e: React.KeyboardEvent<HTMLElement>,
    action: () => void
  ) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      action();
    }
  };

  const handleScrollTemplates = (direction: 'left' | 'right') => {
    const container = templateRowRef.current;
    if (!container) return;
    const scrollAmount = direction === 'left' ? -560 : 560;
    container.scrollBy({ left: scrollAmount, behavior: 'smooth' });
  };

  const handleOpenRename = (lesson: LessonRecord) => {
    setOpenMenuId(null);
    setRenamingLesson(lesson);
    setRenameDraft(lesson.title);
  };

  const handleConfirmRename = (e: React.FormEvent) => {
    e.preventDefault();
    if (!renamingLesson) return;
    lessonStore.rename(renamingLesson.id, renameDraft);
    setLessons(lessonStore.list());
    setRenamingLesson(null);
  };

  const handleDuplicateLesson = (lessonId: string) => {
    setOpenMenuId(null);
    lessonStore.duplicate(lessonId);
    setLessons(lessonStore.list());
  };

  const handleOpenDelete = (lesson: LessonRecord) => {
    setOpenMenuId(null);
    setDeletingLesson(lesson);
  };

  const handleConfirmDelete = () => {
    if (!deletingLesson) return;
    lessonStore.delete(deletingLesson.id);
    setLessons(lessonStore.list());
    setDeletingLesson(null);
  };

  const filteredAndSortedLessons = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const filtered = query
      ? lessons.filter((l) => l.title.toLowerCase().includes(query))
      : [...lessons];

    if (sortBy === 'title') {
      return filtered.sort((a, b) =>
        (a.title || 'Untitled lesson').localeCompare(
          b.title || 'Untitled lesson',
          undefined,
          { sensitivity: 'base' }
        )
      );
    }

    return filtered.sort(
      (a, b) =>
        new Date(b.updatedAt || b.createdAt).getTime() -
        new Date(a.updatedAt || a.createdAt).getTime()
    );
  }, [lessons, searchQuery, sortBy]);

  return (
    <div className="min-h-screen bg-canvas text-ink antialiased flex flex-col">
      {/* 1. TOP BAR (same style as workspace top bar, max-w-[1440px] centered with 24px side padding) */}
      <header className="w-full border-b border-border/70 bg-canvas/95 sticky top-0 z-30">
        <div className="max-w-[1440px] mx-auto h-16 px-4 sm:px-6 flex items-center justify-between gap-3">
          {/* Left: Logo mark + wordmark + "All" / "My lessons" pill tabs */}
          <div className="flex items-center gap-4 sm:gap-6 min-w-0">
            <Link
              to="/"
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

            {/* Filter tabs ("All" and "My lessons" as small pills) */}
            <div
              role="tablist"
              aria-label="Lesson library tabs"
              className="flex items-center gap-1 bg-surface-muted p-1 rounded-full border border-border"
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'all'}
                onClick={() => setActiveTab('all')}
                className={`px-3 py-1 rounded-full text-[12px] sm:text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  activeTab === 'all'
                    ? 'bg-surface text-ink border border-border'
                    : 'text-ink-muted hover:text-ink border border-transparent'
                }`}
              >
                All
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'mine'}
                onClick={() => setActiveTab('mine')}
                className={`px-3 py-1 rounded-full text-[12px] sm:text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  activeTab === 'mine'
                    ? 'bg-surface text-ink border border-border'
                    : 'text-ink-muted hover:text-ink border border-transparent'
                }`}
              >
                My lessons
              </button>
            </div>
          </div>

          {/* Right: Search lessons field, grid/list toggle, settings icon, avatar */}
          <div className="flex items-center gap-2 sm:gap-2.5 flex-shrink-0">
            {/* Search lessons field */}
            <div className="relative flex items-center">
              <span className="material-symbols-outlined text-[17px] text-ink-muted absolute left-3 pointer-events-none">
                search
              </span>
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search lessons"
                aria-label="Search lessons"
                className="w-36 sm:w-56 md:w-64 pl-9 pr-7 py-1.5 rounded-full bg-surface border border-border focus:border-accent text-[13px] text-ink placeholder-ink-muted focus:outline-none transition-colors"
              />
              {searchQuery && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 text-ink-muted hover:text-ink flex items-center justify-center"
                >
                  <span className="material-symbols-outlined text-[15px]">
                    close
                  </span>
                </button>
              )}
            </div>

            {/* Grid / List view toggle */}
            <div
              role="group"
              aria-label="View mode"
              className="hidden sm:flex items-center bg-surface border border-border rounded-full p-0.5"
            >
              <button
                type="button"
                aria-label="Grid view"
                aria-pressed={viewMode === 'grid'}
                onClick={() => setViewMode('grid')}
                className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  viewMode === 'grid'
                    ? 'bg-surface-muted text-ink'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                <span className="material-symbols-outlined text-[17px]">
                  grid_view
                </span>
              </button>
              <button
                type="button"
                aria-label="List view"
                aria-pressed={viewMode === 'list'}
                onClick={() => setViewMode('list')}
                className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  viewMode === 'list'
                    ? 'bg-surface-muted text-ink'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                <span className="material-symbols-outlined text-[17px]">
                  view_list
                </span>
              </button>
            </div>

            {/* Settings button + popover */}
            <div className="relative">
              <button
                type="button"
                aria-label="Settings"
                onClick={() => setSettingsOpen((prev) => !prev)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span className="material-symbols-outlined text-[19px]">
                  settings
                </span>
              </button>

              {settingsOpen && (
                <div className="absolute right-0 mt-2 w-72 rounded-panel bg-surface border border-border p-4 z-50 text-left">
                  <div className="flex items-center justify-between mb-2.5">
                    <span className="text-[13px] font-semibold text-ink">
                      Lessonwright Studio
                    </span>
                    <button
                      type="button"
                      aria-label="Close settings"
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
                    <div className="flex items-center justify-between pt-1 border-t border-border text-ink-muted">
                      <span>Saved lessons</span>
                      <span className="font-medium text-ink">
                        {lessons.length}
                      </span>
                    </div>
                    {indexedSourceCount !== null && (
                      <div className="flex items-center justify-between text-ink-muted">
                        <span>Indexed sources</span>
                        <span className="font-medium text-ink">
                          {indexedSourceCount}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Avatar */}
            <div className="w-8 h-8 rounded-full bg-surface-avatar border border-border-avatar flex items-center justify-center text-ink-avatar text-[13px] font-medium select-none">
              LW
            </div>
          </div>
        </div>
      </header>

      {/* MAIN CONTENT (desktop max width ~1440px, 24px side padding, bottom padding) */}
      <main className="flex-1 w-full max-w-[1440px] mx-auto px-4 sm:px-6 pt-6 pb-24 space-y-10">
        {/* 2. SECTION: START FROM A TEMPLATE (shown on "All" tab) */}
        {activeTab === 'all' && (
          <section aria-labelledby="templates-heading" className="space-y-4">
            <div className="flex items-center justify-between">
              <h2
                id="templates-heading"
                className="text-[16px] sm:text-[18px] font-semibold text-ink tracking-tight"
              >
                Start from a template
              </h2>
              <button
                type="button"
                onClick={() => setShowAllTemplates((prev) => !prev)}
                className="text-[13px] font-medium text-accent hover:text-accent-hover inline-flex items-center gap-1 rounded px-1.5 py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span>{showAllTemplates ? 'Show carousel' : 'View all'}</span>
                <span className="material-symbols-outlined text-[15px]">
                  {showAllTemplates ? 'view_carousel' : 'arrow_forward'}
                </span>
              </button>
            </div>

            {showAllTemplates ? (
              /* Expanded view when "View all" is toggled */
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                {TEMPLATES.map((tpl) => {
                  const sourceCount =
                    indexedSourceCount ?? tpl.defaultSourceCount;
                  return (
                    <div
                      key={tpl.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleStartFromTemplate(tpl)}
                      onKeyDown={(e) =>
                        handleCardKeyDown(e, () => handleStartFromTemplate(tpl))
                      }
                      style={{ backgroundColor: tpl.bgTintStyle }}
                      className="lesson-card-hover h-[190px] sm:h-[210px] rounded-[24px] border border-border hover:border-border-strong p-5 flex flex-col justify-between text-left cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <div className="w-10 h-10 rounded-xl bg-surface/80 border border-border/80 flex items-center justify-center">
                        <span
                          className={`material-symbols-outlined text-[20px] ${tpl.iconColorClass}`}
                        >
                          {tpl.icon}
                        </span>
                      </div>

                      <div className="space-y-1.5">
                        <h3 className="text-[15px] font-semibold text-ink leading-snug line-clamp-2">
                          {tpl.title}
                        </h3>
                        <p className="text-[12px] text-ink-muted font-medium">
                          {tpl.levelLabel} · {tpl.durationMin} min ·{' '}
                          {sourceCount}{' '}
                          {sourceCount === 1 ? 'source' : 'sources'}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Horizontally scrollable row (scroll-snap, hidden scrollbar, arrow buttons on hover) */
              <div className="relative group/templates">
                {/* Left scroll arrow (appears on hover on desktop) */}
                <button
                  type="button"
                  aria-label="Scroll templates left"
                  onClick={() => handleScrollTemplates('left')}
                  className="hidden md:flex opacity-0 group-hover/templates:opacity-100 focus-visible:opacity-100 transition-opacity duration-150 absolute left-2 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-surface border border-border-strong text-ink hover:border-accent hover:text-accent items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <span className="material-symbols-outlined text-[18px]">
                    chevron_left
                  </span>
                </button>

                <div
                  ref={templateRowRef}
                  className="flex items-stretch gap-4 overflow-x-auto no-scrollbar snap-x snap-mandatory py-1"
                >
                  {TEMPLATES.map((tpl) => {
                    const sourceCount =
                      indexedSourceCount ?? tpl.defaultSourceCount;
                    return (
                      <div
                        key={tpl.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => handleStartFromTemplate(tpl)}
                        onKeyDown={(e) =>
                          handleCardKeyDown(e, () =>
                            handleStartFromTemplate(tpl)
                          )
                        }
                        style={{ backgroundColor: tpl.bgTintStyle }}
                        className="lesson-card-hover snap-start flex-shrink-0 w-[220px] h-[180px] md:w-[260px] md:h-[210px] rounded-[24px] border border-border hover:border-border-strong p-5 flex flex-col justify-between text-left cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        <div className="w-10 h-10 rounded-xl bg-surface/80 border border-border/80 flex items-center justify-center">
                          <span
                            className={`material-symbols-outlined text-[20px] ${tpl.iconColorClass}`}
                          >
                            {tpl.icon}
                          </span>
                        </div>

                        <div className="space-y-1.5">
                          <h3 className="text-[15px] sm:text-[16px] font-semibold text-ink leading-snug line-clamp-2">
                            {tpl.title}
                          </h3>
                          <p className="text-[12px] text-ink-muted font-medium">
                            {tpl.levelLabel} · {tpl.durationMin} min ·{' '}
                            {sourceCount}{' '}
                            {sourceCount === 1 ? 'source' : 'sources'}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Right scroll arrow (appears on hover on desktop) */}
                <button
                  type="button"
                  aria-label="Scroll templates right"
                  onClick={() => handleScrollTemplates('right')}
                  className="hidden md:flex opacity-0 group-hover/templates:opacity-100 focus-visible:opacity-100 transition-opacity duration-150 absolute right-2 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-surface border border-border-strong text-ink hover:border-accent hover:text-accent items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <span className="material-symbols-outlined text-[18px]">
                    chevron_right
                  </span>
                </button>
              </div>
            )}
          </section>
        )}

        {/* 3. SECTION: RECENT LESSONS */}
        <section aria-labelledby="recent-lessons-heading" className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2
              id="recent-lessons-heading"
              className="text-[16px] sm:text-[18px] font-semibold text-ink tracking-tight"
            >
              Recent lessons
            </h2>

            {/* Right controls: Sort dropdown + "+ New lesson" solid teal pill button */}
            <div className="flex items-center gap-2.5">
              {/* Sort dropdown (Most recent, Title) */}
              <div ref={sortMenuRef} className="relative">
                <button
                  type="button"
                  aria-label="Sort lessons"
                  aria-expanded={sortDropdownOpen}
                  onClick={() => setSortDropdownOpen((prev) => !prev)}
                  className="px-3.5 py-1.5 rounded-full bg-surface border border-border hover:border-border-strong text-[13px] font-medium text-ink flex items-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <span className="text-ink-muted">Sort:</span>
                  <span>{sortBy === 'recent' ? 'Most recent' : 'Title'}</span>
                  <span className="material-symbols-outlined text-[16px] text-ink-muted">
                    expand_more
                  </span>
                </button>

                {sortDropdownOpen && (
                  <div className="absolute right-0 mt-1.5 w-40 rounded-xl bg-surface border border-border py-1 z-30">
                    <button
                      type="button"
                      onClick={() => {
                        setSortBy('recent');
                        setSortDropdownOpen(false);
                      }}
                      className={`w-full text-left px-3 py-1.5 text-[13px] hover:bg-surface-muted flex items-center justify-between ${
                        sortBy === 'recent'
                          ? 'text-accent font-semibold'
                          : 'text-ink'
                      }`}
                    >
                      <span>Most recent</span>
                      {sortBy === 'recent' && (
                        <span className="material-symbols-outlined text-[15px]">
                          check
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSortBy('title');
                        setSortDropdownOpen(false);
                      }}
                      className={`w-full text-left px-3 py-1.5 text-[13px] hover:bg-surface-muted flex items-center justify-between ${
                        sortBy === 'title'
                          ? 'text-accent font-semibold'
                          : 'text-ink'
                      }`}
                    >
                      <span>Title</span>
                      {sortBy === 'title' && (
                        <span className="material-symbols-outlined text-[15px]">
                          check
                        </span>
                      )}
                    </button>
                  </div>
                )}
              </div>

              {/* Solid teal pill button "+ New lesson" */}
              <button
                type="button"
                onClick={handleCreateNewLesson}
                className="px-4 py-1.5 rounded-full bg-accent hover:bg-accent-hover text-white text-[13px] sm:text-[14px] font-medium transition-colors flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
              >
                <span className="material-symbols-outlined text-[18px]">
                  add
                </span>
                <span>New lesson</span>
              </button>
            </div>
          </div>

          {/* Empty state when there are no lessons at all */}
          {lessons.length === 0 ? (
            <div className="rounded-[24px] bg-surface border border-border p-10 sm:p-14 flex flex-col items-center justify-center text-center max-w-xl mx-auto my-6">
              <div className="w-12 h-12 rounded-2xl bg-surface-muted border border-border flex items-center justify-center text-ink-muted mb-4">
                <span className="material-symbols-outlined text-[24px]">
                  library_books
                </span>
              </div>
              <h3 className="text-[17px] font-semibold text-ink">
                No lessons yet
              </h3>
              <p className="text-[14px] text-ink-muted mt-1 max-w-sm">
                Start from a prompt engineering template above or create a blank
                lesson grounded in your sources.
              </p>
              <button
                type="button"
                onClick={handleCreateNewLesson}
                className="mt-5 px-4 py-2 rounded-full bg-accent hover:bg-accent-hover text-white text-[14px] font-medium transition-colors inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
              >
                <span className="material-symbols-outlined text-[18px]">
                  add
                </span>
                <span>New lesson</span>
              </button>
            </div>
          ) : filteredAndSortedLessons.length === 0 ? (
            /* No search matches */
            <div className="rounded-[24px] bg-surface border border-border p-10 flex flex-col items-center justify-center text-center max-w-lg mx-auto my-4">
              <span className="material-symbols-outlined text-[24px] text-ink-muted mb-2">
                search_off
              </span>
              <p className="text-[15px] font-medium text-ink">
                No lessons matching "{searchQuery}"
              </p>
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="mt-3 text-[13px] font-medium text-accent hover:text-accent-hover"
              >
                Clear search
              </button>
            </div>
          ) : viewMode === 'list' ? (
            /* List view (full-width rows: title, date, sources, level, duration, three-dot menu) */
            <div className="flex flex-col gap-2.5">
              {filteredAndSortedLessons.map((lesson) => {
                const visual = getLessonVisual(lesson.id);
                const effectiveSources =
                  lesson.sourceCount || indexedSourceCount || 0;
                const levelText = formatLevelLabel(
                  lesson.plan?.level || lesson.settings?.level || 'beginner'
                );
                const durationMin =
                  lesson.plan?.duration_min ||
                  lesson.settings?.duration_min ||
                  60;

                return (
                  <div
                    key={lesson.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleOpenLesson(lesson.id)}
                    onKeyDown={(e) =>
                      handleCardKeyDown(e, () => handleOpenLesson(lesson.id))
                    }
                    className="lesson-card-hover group relative w-full rounded-[20px] bg-surface border border-border hover:border-border-strong px-4 py-3.5 flex items-center justify-between gap-4 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <div className="flex items-center gap-3.5 min-w-0 flex-1">
                      <div
                        style={{ backgroundColor: visual.bg }}
                        className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                      >
                        <span
                          className={`material-symbols-outlined text-[20px] ${visual.textClass}`}
                        >
                          {visual.icon}
                        </span>
                      </div>

                      <div className="min-w-0 flex-1">
                        <h3 className="text-[15px] font-semibold text-ink truncate">
                          {lesson.title || 'Untitled lesson'}
                        </h3>
                        <p className="text-[12px] text-ink-muted mt-0.5 sm:hidden">
                          {formatLessonDate(
                            lesson.updatedAt || lesson.createdAt
                          )}{' '}
                          · {effectiveSources}{' '}
                          {effectiveSources === 1 ? 'source' : 'sources'}
                        </p>
                      </div>
                    </div>

                    <div className="hidden sm:flex items-center gap-4 text-[13px] text-ink-muted flex-shrink-0">
                      <span>
                        {formatLessonDate(lesson.updatedAt || lesson.createdAt)}
                      </span>
                      <span className="text-border-strong">·</span>
                      <span>
                        {effectiveSources}{' '}
                        {effectiveSources === 1 ? 'source' : 'sources'}
                      </span>
                      <span className="px-2.5 py-0.5 rounded-full bg-surface-muted border border-border text-[12px] font-medium text-ink">
                        {levelText} · {durationMin} min
                      </span>
                    </div>

                    {/* Three-dot menu */}
                    <div
                      data-card-menu
                      className="relative flex-shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        aria-label={`More actions for ${lesson.title}`}
                        onClick={() =>
                          setOpenMenuId((curr) =>
                            curr === lesson.id ? null : lesson.id
                          )
                        }
                        className="w-8 h-8 rounded-full flex items-center justify-center text-ink-muted hover:text-ink hover:bg-surface-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        <span className="material-symbols-outlined text-[18px]">
                          more_vert
                        </span>
                      </button>

                      {openMenuId === lesson.id && (
                        <div className="absolute right-0 mt-1 w-40 rounded-xl bg-surface border border-border py-1 z-30">
                          <button
                            type="button"
                            onClick={() => handleOpenRename(lesson)}
                            className="w-full text-left px-3 py-1.5 text-[13px] text-ink hover:bg-surface-muted flex items-center gap-2"
                          >
                            <span className="material-symbols-outlined text-[16px] text-ink-muted">
                              edit
                            </span>
                            <span>Rename</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDuplicateLesson(lesson.id)}
                            className="w-full text-left px-3 py-1.5 text-[13px] text-ink hover:bg-surface-muted flex items-center gap-2"
                          >
                            <span className="material-symbols-outlined text-[16px] text-ink-muted">
                              content_copy
                            </span>
                            <span>Duplicate</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenDelete(lesson)}
                            className="w-full text-left px-3 py-1.5 text-[13px] text-danger hover:bg-danger-soft flex items-center gap-2"
                          >
                            <span className="material-symbols-outlined text-[16px]">
                              delete
                            </span>
                            <span>Delete</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* Grid view: 1-column list on < 768px, responsive grid repeat(auto-fill, minmax(240px, 1fr)) on >= 768px */
            <div className="grid grid-cols-1 md:grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
              {filteredAndSortedLessons.map((lesson) => {
                const visual = getLessonVisual(lesson.id);
                const effectiveSources =
                  lesson.sourceCount || indexedSourceCount || 0;
                const planLevel = formatLevelLabel(
                  lesson.plan?.level || lesson.settings?.level || 'beginner'
                );
                const planDuration =
                  lesson.plan?.duration_min ||
                  lesson.settings?.duration_min ||
                  60;

                return (
                  <div
                    key={lesson.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleOpenLesson(lesson.id)}
                    onKeyDown={(e) =>
                      handleCardKeyDown(e, () => handleOpenLesson(lesson.id))
                    }
                    className="lesson-card-hover group relative rounded-[24px] bg-surface border border-border hover:border-border-strong p-5 flex flex-col justify-between min-h-[188px] cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {/* Card top row: Tinted square icon at top-left, three-dot menu at top-right */}
                    <div className="flex items-start justify-between gap-2">
                      <div
                        style={{ backgroundColor: visual.bg }}
                        className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                      >
                        <span
                          className={`material-symbols-outlined text-[20px] ${visual.textClass}`}
                        >
                          {visual.icon}
                        </span>
                      </div>

                      <div
                        data-card-menu
                        className="relative"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          aria-label={`More actions for ${lesson.title}`}
                          onClick={() =>
                            setOpenMenuId((curr) =>
                              curr === lesson.id ? null : lesson.id
                            )
                          }
                          className="w-8 h-8 rounded-full flex items-center justify-center text-ink-muted hover:text-ink hover:bg-surface-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          <span className="material-symbols-outlined text-[18px]">
                            more_vert
                          </span>
                        </button>

                        {openMenuId === lesson.id && (
                          <div className="absolute right-0 mt-1 w-40 rounded-xl bg-surface border border-border py-1 z-30">
                            <button
                              type="button"
                              onClick={() => handleOpenRename(lesson)}
                              className="w-full text-left px-3 py-1.5 text-[13px] text-ink hover:bg-surface-muted flex items-center gap-2"
                            >
                              <span className="material-symbols-outlined text-[16px] text-ink-muted">
                                edit
                              </span>
                              <span>Rename</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDuplicateLesson(lesson.id)}
                              className="w-full text-left px-3 py-1.5 text-[13px] text-ink hover:bg-surface-muted flex items-center gap-2"
                            >
                              <span className="material-symbols-outlined text-[16px] text-ink-muted">
                                content_copy
                              </span>
                              <span>Duplicate</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleOpenDelete(lesson)}
                              className="w-full text-left px-3 py-1.5 text-[13px] text-danger hover:bg-danger-soft flex items-center gap-2"
                            >
                              <span className="material-symbols-outlined text-[16px]">
                                delete
                              </span>
                              <span>Delete</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Card bottom content: Title (max 2 lines), meta line, and level/duration pill when plan exists */}
                    <div className="mt-5 space-y-2">
                      <h3 className="text-[15px] font-semibold text-ink leading-snug line-clamp-2 break-words">
                        {lesson.title || 'Untitled lesson'}
                      </h3>

                      <div className="flex items-center justify-between gap-2 flex-wrap pt-0.5">
                        <p className="text-[12px] text-ink-muted">
                          {formatLessonDate(
                            lesson.updatedAt || lesson.createdAt
                          )}{' '}
                          · {effectiveSources}{' '}
                          {effectiveSources === 1 ? 'source' : 'sources'}
                        </p>

                        {lesson.plan && (
                          <span className="px-2.5 py-0.5 rounded-full bg-surface-muted border border-border text-[11px] font-medium text-ink">
                            {planLevel} · {planDuration} min
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>

      {/* Mobile (< 768px) floating round teal "+" button at bottom-right */}
      <button
        type="button"
        aria-label="Create new lesson"
        onClick={handleCreateNewLesson}
        className="md:hidden fixed bottom-6 right-6 z-30 w-13 h-13 p-3.5 rounded-full bg-accent hover:bg-accent-hover text-white flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
      >
        <span className="material-symbols-outlined text-[24px]">add</span>
      </button>

      {/* Rename Modal */}
      {renamingLesson && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="rename-lesson-title"
          className="fixed inset-0 z-50 bg-ink/20 flex items-center justify-center p-4"
          onClick={() => setRenamingLesson(null)}
        >
          <div
            className="w-full max-w-md rounded-[20px] bg-surface border border-border p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3
                id="rename-lesson-title"
                className="text-[15px] font-semibold text-ink"
              >
                Rename lesson
              </h3>
              <button
                type="button"
                aria-label="Close rename modal"
                onClick={() => setRenamingLesson(null)}
                className="text-ink-muted hover:text-ink"
              >
                <span className="material-symbols-outlined text-[18px]">
                  close
                </span>
              </button>
            </div>

            <form onSubmit={handleConfirmRename} className="space-y-4">
              <input
                ref={renameInputRef}
                type="text"
                value={renameDraft}
                onChange={(e) => setRenameDraft(e.target.value)}
                placeholder="Untitled lesson"
                aria-label="Lesson title"
                className="w-full px-3.5 py-2 rounded-xl bg-surface-muted border border-border focus:border-accent text-[14px] text-ink focus:outline-none"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRenamingLesson(null)}
                  className="px-3.5 py-1.5 rounded-full border border-border text-[13px] font-medium text-ink-muted hover:text-ink hover:bg-surface-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-full bg-accent hover:bg-accent-hover text-white text-[13px] font-medium transition-colors"
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingLesson && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-lesson-title"
          className="fixed inset-0 z-50 bg-ink/20 flex items-center justify-center p-4"
          onClick={() => setDeletingLesson(null)}
        >
          <div
            className="w-full max-w-md rounded-[20px] bg-surface border border-border p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3
                id="delete-lesson-title"
                className="text-[15px] font-semibold text-ink"
              >
                Delete lesson?
              </h3>
              <button
                type="button"
                aria-label="Close delete confirmation"
                onClick={() => setDeletingLesson(null)}
                className="text-ink-muted hover:text-ink"
              >
                <span className="material-symbols-outlined text-[18px]">
                  close
                </span>
              </button>
            </div>

            <p className="text-[13px] text-ink-muted leading-relaxed">
              Are you sure you want to delete{' '}
              <span className="font-medium text-ink">
                "{deletingLesson.title || 'Untitled lesson'}"
              </span>
              ? This action cannot be undone.
            </p>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeletingLesson(null)}
                className="px-3.5 py-1.5 rounded-full border border-border text-[13px] font-medium text-ink-muted hover:text-ink hover:bg-surface-muted transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="px-4 py-1.5 rounded-full bg-danger text-white text-[13px] font-medium hover:opacity-90 transition-opacity"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
