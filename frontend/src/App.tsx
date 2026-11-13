import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Group,
  GroupImperativeHandle,
  Layout,
  Panel,
  PanelImperativeHandle,
  Separator,
} from 'react-resizable-panels';
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import {
  ChatSettings,
  createSessionId,
  fetchSources,
  ingestSource,
  LessonPlan,
  SourceItem,
  SourceSummary,
  streamChat,
} from './api/client';
import { ChatMessage, ChatPanel } from './components/ChatPanel';
import { CitationPopover } from './components/CitationPopover';
import { ActiveCitationTarget } from './components/CitationText';
import { SourcesPanel } from './components/SourcesPanel';
import { StudioPanel } from './components/StudioPanel';
import { TopBar } from './components/TopBar';
import * as lessonStore from './lib/lessons';
import { HomePage } from './pages/HomePage';

type MobileTab = 'sources' | 'chat' | 'studio';

const WORKSPACE_AUTO_SAVE_ID = 'lessonwright-workspace-layout';
const DEFAULT_LAYOUT: Layout = {
  sources: 22,
  chat: 48,
  studio: 30,
};

function loadPersistedLayout(autoSaveId: string): Layout {
  try {
    const raw = window.localStorage.getItem(
      `react-resizable-panels:${autoSaveId}`
    );
    if (!raw) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(raw) as Layout;
    if (
      typeof parsed?.sources === 'number' &&
      typeof parsed?.chat === 'number' &&
      typeof parsed?.studio === 'number' &&
      Math.abs(parsed.sources + parsed.chat + parsed.studio - 100) < 2
    ) {
      return parsed;
    }
  } catch {
    // Ignore storage errors (e.g. private browsing or disabled storage)
  }
  return DEFAULT_LAYOUT;
}

function savePersistedLayout(autoSaveId: string, layout: Layout): void {
  try {
    window.localStorage.setItem(
      `react-resizable-panels:${autoSaveId}`,
      JSON.stringify(layout)
    );
  } catch {
    // Ignore storage quota or security errors
  }
}

function resolveRestoredPlanState(record: lessonStore.LessonRecord | null): {
  plan: LessonPlan | null;
  activePlanId: string | null;
  sources: SourceItem[];
} {
  if (!record) {
    return { plan: null, activePlanId: null, sources: [] };
  }

  const msgs = record.messages || [];

  // 1. If activePlanId is saved, try to find that exact message's plan
  if (record.activePlanId) {
    const matched = msgs.find(
      (m) => (m.planId || m.id) === record.activePlanId && m.plan
    );
    if (matched && matched.plan) {
      return {
        plan: matched.plan,
        activePlanId: matched.planId || matched.id,
        sources: matched.sources || [],
      };
    }
  }

  // 2. Otherwise fall back to the latest message with a plan
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    const m = msgs[i];
    if (m.plan) {
      return {
        plan: record.plan ?? m.plan,
        activePlanId: record.activePlanId || m.planId || m.id,
        sources: m.sources || [],
      };
    }
  }

  // 3. Fallback if no message has a plan attached
  let fallbackSources: SourceItem[] = [];
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    if (msgs[i].sources && msgs[i].sources!.length > 0) {
      fallbackSources = msgs[i].sources!;
      break;
    }
  }

  return {
    plan: record.plan ?? null,
    activePlanId: record.activePlanId ?? null,
    sources: fallbackSources,
  };
}

interface WorkspaceDividerProps {
  id: string;
  ariaLabel: string;
  onDoubleClick: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onDragStateChange: (dragging: boolean) => void;
}

const WorkspaceDivider: React.FC<WorkspaceDividerProps> = ({
  id,
  ariaLabel,
  onDoubleClick,
  onKeyDown,
  onDragStateChange,
}) => {
  return (
    <Separator
      id={id}
      aria-label={ariaLabel}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      onPointerDown={() => onDragStateChange(true)}
      className="group relative w-3 flex-shrink-0 flex items-center justify-center cursor-col-resize select-none rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {/* 1px hairline #E4E6EB that turns teal on hover, drag, or focus */}
      <div className="divider-line w-px h-full bg-border transition-colors duration-150" />

      {/* Three-dot center grip that appears only on hover, drag, or focus */}
      <div className="divider-grip opacity-0 transition-opacity duration-150 absolute top-1/2 -translate-y-1/2 flex flex-col items-center justify-center gap-1 py-1.5 px-1 rounded-full bg-canvas">
        <span className="w-1 h-1 rounded-full bg-accent" />
        <span className="w-1 h-1 rounded-full bg-accent" />
        <span className="w-1 h-1 rounded-full bg-accent" />
      </div>
    </Separator>
  );
};

const LessonWorkspace: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  // The :id route parameter is the session_id sent to POST /chat
  const sessionId = id || '';

  /**
   * NOTE: Because the backend currently keeps chat sessions only in memory,
   * we restore `messages`, `plan`, and `settings` from the local lesson store
   * (`lessonwright.lessons`) when opening `/lesson/:id`, and auto-save changes.
   * A persistent backend store can replace this later.
   */
  const initialRecord = useRef(
    sessionId ? lessonStore.get(sessionId) : null
  ).current;

  const [createdAt, setCreatedAt] = useState<string>(
    () => initialRecord?.createdAt || new Date().toISOString()
  );
  const [lessonTitle, setLessonTitle] = useState<string>(
    () =>
      (initialRecord?.plan?.title && !initialRecord?.titleManuallyEdited
        ? initialRecord.plan.title
        : initialRecord?.title) || 'Untitled lesson'
  );
  const [titleManuallyEdited, setTitleManuallyEdited] = useState<boolean>(
    () => Boolean(initialRecord?.titleManuallyEdited)
  );
  const [initialDraft, setInitialDraft] = useState<string>(() => {
    const routePrompt = (
      location.state as { initialPrompt?: string } | null
    )?.initialPrompt;
    return routePrompt || initialRecord?.initialPrompt || '';
  });

  // Responsive viewport check (< 768px uses sliding mobile tabs, >= 768px uses resizable panels)
  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(() =>
    typeof window !== 'undefined'
      ? !window.matchMedia('(min-width: 768px)').matches
      : false
  );
  const [mobileTab, setMobileTab] = useState<MobileTab>('chat');

  // Resizable panel imperative refs & persisted initial layout
  const [initialLayout] = useState<Layout>(() =>
    loadPersistedLayout(WORKSPACE_AUTO_SAVE_ID)
  );
  const groupRef = useRef<GroupImperativeHandle>(null);
  const sourcesPanelRef = useRef<PanelImperativeHandle>(null);
  const studioPanelRef = useRef<PanelImperativeHandle>(null);

  // Desktop collapsible side panel state
  const [leftCollapsed, setLeftCollapsed] = useState<boolean>(
    () => initialLayout.sources < 1
  );
  const [rightCollapsed, setRightCollapsed] = useState<boolean>(
    () => initialLayout.studio < 1
  );
  const [isDraggingDivider, setIsDraggingDivider] = useState<boolean>(false);

  // Sources state (GET /sources & POST /ingest)
  const [sources, setSources] = useState<SourceSummary[]>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>(
    () => initialRecord?.settings?.source_ids ?? []
  );
  const [sourcesLoading, setSourcesLoading] = useState<boolean>(true);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const initialSelectionDone = useRef<boolean>(
    Boolean(
      initialRecord?.settings?.source_ids &&
        initialRecord.settings.source_ids.length > 0
    )
  );

  // Chat & LessonPlan state restored from the lesson record
  const initialPlanState = useRef(
    resolveRestoredPlanState(initialRecord)
  ).current;

  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    (initialRecord?.messages || []).map((m) => ({
      ...m,
      planId: m.plan ? m.planId || m.id : m.planId,
      isStreaming: false,
      currentStatus: null,
    }))
  );
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [currentStatus, setCurrentStatus] = useState<string | null>(null);
  const [currentPlan, setCurrentPlan] = useState<LessonPlan | null>(
    () => initialPlanState.plan
  );
  const [activePlanId, setActivePlanId] = useState<string | null>(
    () => initialPlanState.activePlanId
  );
  const [studioScrollSignal, setStudioScrollSignal] = useState<number>(0);
  const [latestSources, setLatestSources] = useState<SourceItem[]>(
    () => initialPlanState.sources
  );

  // Request settings restored from the lesson record
  const [settings, setSettings] = useState<ChatSettings>(() => ({
    level: initialRecord?.settings?.level || 'beginner',
    duration_min: initialRecord?.settings?.duration_min ?? 60,
    audience: initialRecord?.settings?.audience || 'All',
    objectives: initialRecord?.settings?.objectives ?? [],
    source_ids: initialRecord?.settings?.source_ids ?? null,
  }));

  // Active citation popover state
  const [activeCitation, setActiveCitation] =
    useState<ActiveCitationTarget | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const hydratedSessionRef = useRef<string>(sessionId);

  // Restore state when navigating between different /lesson/:id routes
  useEffect(() => {
    if (!sessionId) return;
    if (hydratedSessionRef.current === sessionId) return;

    abortControllerRef.current?.abort();
    hydratedSessionRef.current = sessionId;

    const record = lessonStore.get(sessionId);
    const routePrompt = (
      location.state as { initialPrompt?: string } | null
    )?.initialPrompt;

    if (record) {
      const restored = resolveRestoredPlanState(record);
      setCreatedAt(record.createdAt || new Date().toISOString());
      setLessonTitle(
        (restored.plan?.title && !record.titleManuallyEdited
          ? restored.plan.title
          : record.title) || 'Untitled lesson'
      );
      setTitleManuallyEdited(Boolean(record.titleManuallyEdited));
      setMessages(
        (record.messages || []).map((m) => ({
          ...m,
          planId: m.plan ? m.planId || m.id : m.planId,
          isStreaming: false,
          currentStatus: null,
        }))
      );
      setCurrentPlan(restored.plan);
      setActivePlanId(restored.activePlanId);
      setLatestSources(restored.sources);
      setSettings({
        level: record.settings?.level || 'beginner',
        duration_min: record.settings?.duration_min ?? 60,
        audience: record.settings?.audience || 'All',
        objectives: record.settings?.objectives ?? [],
        source_ids: record.settings?.source_ids ?? null,
      });
      if (
        record.settings?.source_ids &&
        record.settings.source_ids.length > 0
      ) {
        setSelectedSourceIds(record.settings.source_ids);
      }
      setInitialDraft(routePrompt || record.initialPrompt || '');
    } else {
      const created = lessonStore.createEmptyLesson({
        id: sessionId,
        title: 'Untitled lesson',
        sourceCount: sources.length,
        initialPrompt: routePrompt,
      });
      setCreatedAt(created.createdAt);
      setLessonTitle(created.title);
      setTitleManuallyEdited(false);
      setMessages([]);
      setCurrentPlan(null);
      setActivePlanId(null);
      setLatestSources([]);
      setSettings({
        level: 'beginner',
        duration_min: 60,
        audience: 'All',
        objectives: [],
        source_ids: selectedSourceIds.length > 0 ? selectedSourceIds : null,
      });
      setInitialDraft(routePrompt || '');
    }

    setIsStreaming(false);
    setCurrentStatus(null);
    setActiveCitation(null);
  }, [location.state, selectedSourceIds, sessionId, sources.length]);

  // Auto-save lesson record whenever messages, plan, settings, title, or sourceCount change
  useEffect(() => {
    if (!sessionId) return;
    const effectiveTitle =
      !titleManuallyEdited && currentPlan?.title
        ? currentPlan.title
        : lessonTitle || 'Untitled lesson';

    const effectiveSourceCount =
      selectedSourceIds.length > 0 ? selectedSourceIds.length : sources.length;

    lessonStore.save({
      id: sessionId,
      title: effectiveTitle,
      createdAt,
      updatedAt: new Date().toISOString(),
      sourceCount: effectiveSourceCount,
      settings: {
        level: settings.level,
        duration_min: settings.duration_min,
        audience: settings.audience,
        objectives: settings.objectives,
        source_ids: settings.source_ids,
      },
      messages,
      plan: currentPlan,
      activePlanId,
      initialPrompt: initialDraft || undefined,
      titleManuallyEdited,
    });
  }, [
    activePlanId,
    createdAt,
    currentPlan,
    initialDraft,
    lessonTitle,
    messages,
    selectedSourceIds.length,
    sessionId,
    settings,
    sources.length,
    titleManuallyEdited,
  ]);

  // Track viewport breakpoint (< 768px vs >= 768px)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const handleChange = (e: MediaQueryListEvent) => {
      setIsMobileViewport(!e.matches);
    };
    setIsMobileViewport(!mq.matches);
    mq.addEventListener('change', handleChange);
    return () => mq.removeEventListener('change', handleChange);
  }, []);

  // Clear pointer drag flag on window pointerup/cancel
  useEffect(() => {
    if (!isDraggingDivider) return;
    const stopDrag = () => setIsDraggingDivider(false);
    window.addEventListener('pointerup', stopDrag);
    window.addEventListener('pointercancel', stopDrag);
    return () => {
      window.removeEventListener('pointerup', stopDrag);
      window.removeEventListener('pointercancel', stopDrag);
    };
  }, [isDraggingDivider]);

  // Collapse / expand / reset helpers for the resizable panels
  const collapseSourcesPanel = useCallback(() => {
    sourcesPanelRef.current?.collapse();
    setLeftCollapsed(true);
  }, [sourcesPanelRef]);

  const expandSourcesPanel = useCallback(() => {
    const panel = sourcesPanelRef.current;
    if (panel) {
      panel.expand();
      if (panel.getSize().asPercentage < 16) {
        panel.resize('22%');
      }
    }
    setLeftCollapsed(false);
  }, [sourcesPanelRef]);

  const collapseStudioPanel = useCallback(() => {
    studioPanelRef.current?.collapse();
    setRightCollapsed(true);
  }, [studioPanelRef]);

  const expandStudioPanel = useCallback(
    (minTargetPercent = 30) => {
      const group = groupRef.current;
      const panel = studioPanelRef.current;
      if (panel && panel.isCollapsed()) {
        panel.expand();
      }
      if (group) {
        const current = group.getLayout();
        const currentStudio = current.studio ?? 0;
        const targetStudio = Math.min(
          50,
          Math.max(currentStudio, minTargetPercent)
        );
        const currentSources = current.sources ?? 22;
        const maxAllowedSources = 100 - targetStudio - 30;
        const nextSources =
          currentSources < 1
            ? 0
            : Math.max(16, Math.min(currentSources, maxAllowedSources));
        const nextChat = 100 - nextSources - targetStudio;
        group.setLayout({
          sources: nextSources,
          chat: nextChat,
          studio: targetStudio,
        });
      } else if (panel) {
        panel.expand();
        if (panel.getSize().asPercentage < minTargetPercent) {
          panel.resize(`${minTargetPercent}%`);
        }
      }
      setRightCollapsed(false);
    },
    [groupRef, studioPanelRef]
  );

  const handleOpenPlanInStudio = useCallback(
    (
      planToOpen: LessonPlan | null | undefined,
      planId: string,
      planSources?: SourceItem[]
    ) => {
      if (!planToOpen) {
        console.warn(
          `[Lessonwright] Plan card (${planId}) has no plan data.`
        );
        return;
      }
      setCurrentPlan(planToOpen);
      setActivePlanId(planId);
      if (planSources && planSources.length > 0) {
        setLatestSources(planSources);
      }
      setSettings((prev) => ({
        ...prev,
        level: planToOpen.level || prev.level,
        duration_min: planToOpen.duration_min || prev.duration_min,
        audience: planToOpen.audience || prev.audience,
      }));
      if (!titleManuallyEdited && planToOpen.title) {
        setLessonTitle(planToOpen.title);
      }
      expandStudioPanel(30);
      setMobileTab('studio');
      setStudioScrollSignal((n) => n + 1);
    },
    [expandStudioPanel, titleManuallyEdited]
  );

  const resetWorkspaceLayout = useCallback(() => {
    groupRef.current?.setLayout(DEFAULT_LAYOUT);
    setLeftCollapsed(false);
    setRightCollapsed(false);
    savePersistedLayout(WORKSPACE_AUTO_SAVE_ID, DEFAULT_LAYOUT);
  }, [groupRef]);

  // Keep settings.source_ids synchronized with checked sources
  useEffect(() => {
    setSettings((prev) => ({
      ...prev,
      source_ids: selectedSourceIds.length > 0 ? selectedSourceIds : null,
    }));
  }, [selectedSourceIds]);

  const loadSources = useCallback(async () => {
    setSourcesLoading(true);
    setSourcesError(null);
    try {
      const list = await fetchSources();
      setSources(list);
      if (!initialSelectionDone.current && list.length > 0) {
        initialSelectionDone.current = true;
        setSelectedSourceIds(list.map((s) => s.id));
      } else {
        // Keep existing valid selections
        setSelectedSourceIds((prev) =>
          prev.filter((id) => list.some((s) => s.id === id))
        );
      }
    } catch {
      setSourcesError("Couldn't reach the server. Retry");
    } finally {
      setSourcesLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSources();
  }, [loadSources]);

  const handleToggleSource = (sourceId: string) => {
    setSelectedSourceIds((prev) =>
      prev.includes(sourceId)
        ? prev.filter((id) => id !== sourceId)
        : [...prev, sourceId]
    );
  };

  const handleSelectAllSources = (selectAll: boolean) => {
    if (selectAll) {
      setSelectedSourceIds(sources.map((s) => s.id));
    } else {
      setSelectedSourceIds([]);
    }
  };

  const handleUploadFiles = async (
    files: FileList | File[],
    meta?: { title?: string; url?: string; topic?: string }
  ) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    setUploading(true);
    setUploadError(null);

    try {
      const newlyUploadedIds: string[] = [];
      for (const file of fileArray) {
        const result = await ingestSource(
          file,
          fileArray.length === 1 ? meta : undefined
        );
        newlyUploadedIds.push(result.source_id);
      }

      const updatedSources = await fetchSources();
      setSources(updatedSources);
      setSourcesError(null);
      initialSelectionDone.current = true;

      setSelectedSourceIds((prev) => {
        const merged = new Set([...prev, ...newlyUploadedIds]);
        return Array.from(merged);
      });
    } catch (err: unknown) {
      setUploadError(
        err instanceof Error
          ? err.message
          : "Couldn't reach the server. Retry"
      );
    } finally {
      setUploading(false);
    }
  };

  const handleUpdateSettings = (patch: Partial<ChatSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  };

  const handleSendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming) return;

      const userMsgId = `user-${Date.now()}`;
      const assistantMsgId = `assistant-${Date.now() + 1}`;

      const userMessage: ChatMessage = {
        id: userMsgId,
        role: 'user',
        content: trimmed,
      };

      const initialAssistantMessage: ChatMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        statusSteps: [],
        currentStatus: 'Searching sources',
        isStreaming: true,
        sources: latestSources,
        plan: null,
        error: null,
        retryPrompt: trimmed,
      };

      setMessages((prev) => [...prev, userMessage, initialAssistantMessage]);
      setIsStreaming(true);
      setCurrentStatus('Searching sources');
      setInitialDraft('');

      const controller = new AbortController();
      abortControllerRef.current = controller;

      const requestSettings: ChatSettings = {
        ...settings,
        source_ids: selectedSourceIds.length > 0 ? selectedSourceIds : null,
      };

      try {
        await streamChat(
          {
            session_id: sessionId,
            message: trimmed,
            settings: requestSettings,
          },
          {
            onStatus: (step) => {
              setCurrentStatus(step);
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantMsgId) return m;
                  const existing = m.statusSteps || [];
                  const nextSteps = existing.includes(step)
                    ? existing
                    : [...existing, step];
                  return {
                    ...m,
                    statusSteps: nextSteps,
                    currentStatus: step,
                  };
                })
              );
            },
            onSources: (items) => {
              setLatestSources(items);
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId ? { ...m, sources: items } : m
                )
              );
            },
            onToken: (tokenText) => {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? { ...m, content: m.content + tokenText }
                    : m
                )
              );
            },
            onPlan: (planData) => {
              setCurrentPlan(planData);
              setActivePlanId(assistantMsgId);
              setStudioScrollSignal((n) => n + 1);
              if (!titleManuallyEdited && planData.title) {
                setLessonTitle(planData.title);
              }
              expandStudioPanel(40);
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? { ...m, plan: planData, planId: assistantMsgId }
                    : m
                )
              );
            },
            onError: (errMsg) => {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? {
                        ...m,
                        isStreaming: false,
                        currentStatus: null,
                        error: errMsg || "Couldn't reach the server. Retry",
                      }
                    : m
                )
              );
            },
            onDone: () => {
              setIsStreaming(false);
              setCurrentStatus(null);
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? { ...m, isStreaming: false, currentStatus: null }
                    : m
                )
              );
            },
          },
          controller.signal
        );
      } catch (err: unknown) {
        if ((err as Error)?.name === 'AbortError') return;
        setIsStreaming(false);
        setCurrentStatus(null);
        const detail =
          err instanceof Error &&
          !err.message.toLowerCase().includes('failed to fetch')
            ? err.message
            : "Couldn't reach the server. Retry";

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  isStreaming: false,
                  currentStatus: null,
                  error: detail,
                }
              : m
          )
        );
      }
    },
    [
      expandStudioPanel,
      isStreaming,
      latestSources,
      selectedSourceIds,
      sessionId,
      settings,
      titleManuallyEdited,
    ]
  );

  const handleRetryMessage = (failedMessageId: string, promptText: string) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === failedMessageId);
      if (idx === -1) return prev;
      const removeStart =
        idx > 0 && prev[idx - 1].role === 'user' ? idx - 1 : idx;
      return prev.slice(0, removeStart);
    });
    setTimeout(() => {
      handleSendMessage(promptText);
    }, 0);
  };

  // "New lesson" creates a uuid, saves an empty lesson record, and navigates to /lesson/:id
  const handleNewLesson = () => {
    abortControllerRef.current?.abort();
    const newId = createSessionId();
    lessonStore.createEmptyLesson({
      id: newId,
      title: 'Untitled lesson',
      sourceCount: sources.length,
    });
    navigate(`/lesson/${newId}`);
  };

  const handleChangeTitle = (newTitle: string) => {
    setLessonTitle(newTitle);
    setTitleManuallyEdited(true);
  };

  const handleInitialDraftConsumed = useCallback(() => {
    setInitialDraft('');
  }, []);

  const mobileSlideIndex =
    mobileTab === 'sources' ? 0 : mobileTab === 'chat' ? 1 : 2;

  return (
    <div className="bg-canvas text-ink min-h-screen h-screen antialiased flex flex-col overflow-hidden">
      {/* Top Bar */}
      <TopBar
        lessonTitle={lessonTitle}
        onChangeTitle={handleChangeTitle}
        onNewLesson={handleNewLesson}
        sessionId={sessionId}
        plan={currentPlan}
        sourcesCount={sources.length}
      />

      {/* Mobile Navigation Tabs (< 768px): Sources | Chat | Studio */}
      <nav
        aria-label="Workspace panels"
        className="md:hidden px-3 pb-2 flex items-center gap-1.5 flex-shrink-0"
      >
        <button
          type="button"
          onClick={() => setMobileTab('sources')}
          className={`flex-1 py-2 px-3 rounded-full text-[13px] font-medium border flex items-center justify-center gap-1.5 transition-colors ${
            mobileTab === 'sources'
              ? 'bg-surface text-ink border-border-strong'
              : 'bg-surface-muted/70 text-ink-muted border-border hover:text-ink'
          }`}
        >
          <span className="material-symbols-outlined text-[16px]">
            description
          </span>
          <span>Sources</span>
          <span className="px-1.5 py-0.2 rounded-full bg-surface-chip text-[11px] text-ink-muted">
            {selectedSourceIds.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setMobileTab('chat')}
          className={`flex-1 py-2 px-3 rounded-full text-[13px] font-medium border flex items-center justify-center gap-1.5 transition-colors ${
            mobileTab === 'chat'
              ? 'bg-surface text-ink border-border-strong'
              : 'bg-surface-muted/70 text-ink-muted border-border hover:text-ink'
          }`}
        >
          <span className="material-symbols-outlined text-[16px]">
            chat_bubble
          </span>
          <span>Chat</span>
        </button>

        <button
          type="button"
          onClick={() => setMobileTab('studio')}
          className={`flex-1 py-2 px-3 rounded-full text-[13px] font-medium border flex items-center justify-center gap-1.5 transition-colors ${
            mobileTab === 'studio'
              ? 'bg-surface text-ink border-border-strong'
              : 'bg-surface-muted/70 text-ink-muted border-border hover:text-ink'
          }`}
        >
          <span className="material-symbols-outlined text-[16px]">
            auto_fix_high
          </span>
          <span>Studio</span>
          {currentPlan && (
            <span className="w-2 h-2 rounded-full bg-accent flex-shrink-0" />
          )}
        </button>
      </nav>

      {/* Main Workspace */}
      <main className="flex-1 w-full px-3 pb-3 pt-0 box-border overflow-hidden min-h-0 relative">
        {isMobileViewport ? (
          /* Mobile (< 768px): Horizontal sliding 3-tab track */
          <div className="w-full h-full overflow-hidden">
            <div
              style={{
                transform: `translateX(-${mobileSlideIndex * (100 / 3)}%)`,
              }}
              className="mobile-tab-track flex w-[300%] h-full transition-transform duration-200 ease-out"
            >
              <div className="w-1/3 h-full pr-1.5 min-w-0">
                <SourcesPanel
                  sources={sources}
                  selectedSourceIds={selectedSourceIds}
                  onToggleSource={handleToggleSource}
                  onSelectAllSources={handleSelectAllSources}
                  loading={sourcesLoading}
                  error={sourcesError}
                  onRetry={loadSources}
                  uploading={uploading}
                  uploadError={uploadError}
                  onUploadFiles={handleUploadFiles}
                  isCollapsed={false}
                  onToggleCollapse={() => {}}
                  onPreviewSource={setActiveCitation}
                />
              </div>

              <div className="w-1/3 h-full px-1 min-w-0">
                <ChatPanel
                  messages={messages}
                  settings={settings}
                  onUpdateSettings={handleUpdateSettings}
                  selectedSourcesCount={selectedSourceIds.length}
                  isStreaming={isStreaming}
                  onSendMessage={handleSendMessage}
                  onRetryMessage={handleRetryMessage}
                  onSelectCitation={setActiveCitation}
                  onUploadFiles={handleUploadFiles}
                  activePlanId={activePlanId}
                  activePlan={currentPlan}
                  onOpenStudio={handleOpenPlanInStudio}
                  initialDraft={initialDraft}
                  onInitialDraftConsumed={handleInitialDraftConsumed}
                />
              </div>

              <div className="w-1/3 h-full pl-1.5 min-w-0">
                <StudioPanel
                  plan={currentPlan}
                  sources={latestSources}
                  isStreaming={isStreaming}
                  currentStatus={currentStatus}
                  onSendQuickAction={(promptText) => {
                    handleSendMessage(promptText);
                    setMobileTab('chat');
                  }}
                  onSelectCitation={setActiveCitation}
                  isCollapsed={false}
                  onToggleCollapse={() => {}}
                  scrollToTopSignal={studioScrollSignal}
                />
              </div>
            </div>
          </div>
        ) : (
          /* Desktop (>= 768px): Resizable & Collapsible 3-Panel Layout */
          <div className="relative w-full h-full flex items-stretch overflow-hidden">
            {/* Edge button to slide Sources back open when collapsed */}
            {leftCollapsed && (
              <button
                type="button"
                onClick={expandSourcesPanel}
                aria-label="Expand sources panel"
                title="Open Sources panel"
                className="z-20 mr-2 my-auto h-12 w-7 rounded-full bg-surface border border-border hover:border-accent text-ink-muted hover:text-accent flex flex-col items-center justify-center transition-colors flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span className="material-symbols-outlined text-[18px]">
                  dock_to_left
                </span>
              </button>
            )}

            <Group
              id={WORKSPACE_AUTO_SAVE_ID}
              groupRef={groupRef}
              orientation="horizontal"
              defaultLayout={initialLayout}
              onLayoutChange={(layout) => {
                savePersistedLayout(WORKSPACE_AUTO_SAVE_ID, layout);
              }}
              data-dragging={isDraggingDivider ? 'true' : 'false'}
              className="workspace-panel-group flex-1 h-full min-w-0"
            >
              {/* 1. LEFT PANEL: SOURCES (default 22%, min 16%, max 35%, collapsible to 0%) */}
              <Panel
                id="sources"
                panelRef={sourcesPanelRef}
                defaultSize="22%"
                minSize="16%"
                maxSize="35%"
                collapsible
                collapsedSize="0%"
                onResize={(size) => {
                  setLeftCollapsed(size.asPercentage < 1);
                }}
                className="h-full min-w-0 overflow-hidden"
              >
                <SourcesPanel
                  sources={sources}
                  selectedSourceIds={selectedSourceIds}
                  onToggleSource={handleToggleSource}
                  onSelectAllSources={handleSelectAllSources}
                  loading={sourcesLoading}
                  error={sourcesError}
                  onRetry={loadSources}
                  uploading={uploading}
                  uploadError={uploadError}
                  onUploadFiles={handleUploadFiles}
                  isCollapsed={leftCollapsed}
                  onToggleCollapse={collapseSourcesPanel}
                  onPreviewSource={setActiveCitation}
                />
              </Panel>

              {/* Draggable Divider: Sources | Chat */}
              <WorkspaceDivider
                id="divider-sources-chat"
                ariaLabel="Resize sources panel"
                onDoubleClick={resetWorkspaceLayout}
                onDragStateChange={setIsDraggingDivider}
                onKeyDown={(e) => {
                  if (e.key === 'Home') {
                    e.preventDefault();
                    collapseSourcesPanel();
                  } else if (e.key === 'End') {
                    e.preventDefault();
                    expandSourcesPanel();
                  }
                }}
              />

              {/* 2. CENTER PANEL: CHAT (min 30%, takes remaining space) */}
              <Panel
                id="chat"
                defaultSize="48%"
                minSize="30%"
                className="h-full min-w-0 overflow-hidden"
              >
                <ChatPanel
                  messages={messages}
                  settings={settings}
                  onUpdateSettings={handleUpdateSettings}
                  selectedSourcesCount={selectedSourceIds.length}
                  isStreaming={isStreaming}
                  onSendMessage={handleSendMessage}
                  onRetryMessage={handleRetryMessage}
                  onSelectCitation={setActiveCitation}
                  onUploadFiles={handleUploadFiles}
                  activePlanId={activePlanId}
                  activePlan={currentPlan}
                  onOpenStudio={handleOpenPlanInStudio}
                  initialDraft={initialDraft}
                  onInitialDraftConsumed={handleInitialDraftConsumed}
                />
              </Panel>

              {/* Draggable Divider: Chat | Studio */}
              <WorkspaceDivider
                id="divider-chat-studio"
                ariaLabel="Resize studio panel"
                onDoubleClick={resetWorkspaceLayout}
                onDragStateChange={setIsDraggingDivider}
                onKeyDown={(e) => {
                  if (e.key === 'End') {
                    e.preventDefault();
                    collapseStudioPanel();
                  } else if (e.key === 'Home') {
                    e.preventDefault();
                    expandStudioPanel(30);
                  }
                }}
              />

              {/* 3. RIGHT PANEL: STUDIO (default 30%, min 22%, max 50%, collapsible to 0%) */}
              <Panel
                id="studio"
                panelRef={studioPanelRef}
                defaultSize="30%"
                minSize="22%"
                maxSize="50%"
                collapsible
                collapsedSize="0%"
                onResize={(size) => {
                  setRightCollapsed(size.asPercentage < 1);
                }}
                className="h-full min-w-0 overflow-hidden"
              >
                <StudioPanel
                  plan={currentPlan}
                  sources={latestSources}
                  isStreaming={isStreaming}
                  currentStatus={currentStatus}
                  onSendQuickAction={(promptText) => {
                    handleSendMessage(promptText);
                  }}
                  onSelectCitation={setActiveCitation}
                  isCollapsed={rightCollapsed}
                  onToggleCollapse={collapseStudioPanel}
                  scrollToTopSignal={studioScrollSignal}
                />
              </Panel>
            </Group>

            {/* Edge button to slide Studio back open when collapsed */}
            {rightCollapsed && (
              <button
                type="button"
                onClick={() => expandStudioPanel(currentPlan ? 40 : 30)}
                aria-label="Expand studio panel"
                title="Open Studio panel"
                className="z-20 ml-2 my-auto h-12 w-7 rounded-full bg-surface border border-border hover:border-accent text-ink-muted hover:text-accent flex flex-col items-center justify-center transition-colors flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span className="material-symbols-outlined text-[18px]">
                  dock_to_right
                </span>
              </button>
            )}
          </div>
        )}
      </main>

      {/* Citation Popover (fetches GET /sources/{id} for chunks) */}
      <CitationPopover
        citation={activeCitation}
        onClose={() => setActiveCitation(null)}
      />
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/lesson/:id" element={<LessonWorkspace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

export default App;
