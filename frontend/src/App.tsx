import React, { useCallback, useEffect, useRef, useState } from 'react';
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

type MobileTab = 'sources' | 'chat' | 'studio';

export const App: React.FC = () => {
  // Per-lesson session UUID
  const [sessionId, setSessionId] = useState<string>(() => createSessionId());
  const [lessonTitle, setLessonTitle] = useState<string>('Untitled lesson');
  const [titleManuallyEdited, setTitleManuallyEdited] = useState<boolean>(false);

  // Mobile responsive tab state
  const [mobileTab, setMobileTab] = useState<MobileTab>('chat');

  // Desktop collapsible side panels
  const [leftCollapsed, setLeftCollapsed] = useState<boolean>(false);
  const [rightCollapsed, setRightCollapsed] = useState<boolean>(false);

  // Sources state (GET /sources & POST /ingest)
  const [sources, setSources] = useState<SourceSummary[]>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState<boolean>(true);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const initialSelectionDone = useRef<boolean>(false);

  // Chat & LessonPlan state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [currentStatus, setCurrentStatus] = useState<string | null>(null);
  const [currentPlan, setCurrentPlan] = useState<LessonPlan | null>(null);
  const [latestSources, setLatestSources] = useState<SourceItem[]>([]);

  // Request settings (fed by Level, Duration, Audience pills + Source checkboxes)
  const [settings, setSettings] = useState<ChatSettings>({
    level: 'beginner',
    duration_min: 60,
    audience: 'All',
    objectives: [],
    source_ids: null,
  });

  // Active citation popover state
  const [activeCitation, setActiveCitation] =
    useState<ActiveCitationTarget | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

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

      // Switch to chat tab on mobile if triggered from Studio quick action
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
              if (!titleManuallyEdited && planData.title) {
                setLessonTitle(planData.title);
              }
              if (rightCollapsed) {
                setRightCollapsed(false);
              }
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId ? { ...m, plan: planData } : m
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
      isStreaming,
      latestSources,
      rightCollapsed,
      selectedSourceIds,
      sessionId,
      settings,
      titleManuallyEdited,
    ]
  );

  const handleRetryMessage = (failedMessageId: string, promptText: string) => {
    // Remove the failed assistant message and its preceding user message, then resend
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

  const handleNewLesson = () => {
    abortControllerRef.current?.abort();
    setSessionId(createSessionId());
    setMessages([]);
    setCurrentPlan(null);
    setLatestSources([]);
    setIsStreaming(false);
    setCurrentStatus(null);
    setLessonTitle('Untitled lesson');
    setTitleManuallyEdited(false);
    setActiveCitation(null);
  };

  const handleChangeTitle = (newTitle: string) => {
    setLessonTitle(newTitle);
    setTitleManuallyEdited(true);
  };

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

      {/* Mobile Navigation Tabs (Sources | Chat | Studio) */}
      <nav
        aria-label="Workspace panels"
        className="lg:hidden px-3 pb-2 flex items-center gap-1.5 flex-shrink-0"
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

      {/* Main 3-Panel Workspace */}
      <main className="flex-1 w-full px-3 pb-3 pt-0 box-border overflow-hidden min-h-0">
        <div className="flex flex-row w-full h-full gap-3 items-stretch overflow-hidden">
          {/* 1. LEFT PANEL: SOURCES */}
          <div
            className={`${
              mobileTab === 'sources' ? 'flex w-full' : 'hidden'
            } lg:flex lg:w-auto h-full`}
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
              onToggleCollapse={() => setLeftCollapsed((v) => !v)}
              onPreviewSource={setActiveCitation}
            />
          </div>

          {/* 2. CENTER PANEL: CHAT */}
          <div
            className={`${
              mobileTab === 'chat' ? 'flex w-full' : 'hidden'
            } lg:flex flex-1 min-w-0 h-full`}
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
              onOpenStudio={() => {
                setRightCollapsed(false);
                setMobileTab('studio');
              }}
            />
          </div>

          {/* 3. RIGHT PANEL: STUDIO */}
          <div
            className={`${
              mobileTab === 'studio' ? 'flex w-full' : 'hidden'
            } lg:flex lg:w-auto h-full`}
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
              onToggleCollapse={() => setRightCollapsed((v) => !v)}
            />
          </div>
        </div>
      </main>

      {/* Citation Popover (fetches GET /sources/{id} for chunks) */}
      <CitationPopover
        citation={activeCitation}
        onClose={() => setActiveCitation(null)}
      />
    </div>
  );
};

export default App;

