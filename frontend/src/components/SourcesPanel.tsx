import React, { useRef, useState } from 'react';
import { SourceSummary } from '../api/client';
import { ActiveCitationTarget } from './CitationText';

interface SourcesPanelProps {
  sources: SourceSummary[];
  selectedSourceIds: string[];
  onToggleSource: (sourceId: string) => void;
  onSelectAllSources: (selectAll: boolean) => void;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  uploading: boolean;
  uploadError: string | null;
  onUploadFiles: (
    files: FileList | File[],
    meta?: { title?: string; url?: string; topic?: string }
  ) => Promise<void>;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onPreviewSource?: (target: ActiveCitationTarget) => void;
}

export const SourcesPanel: React.FC<SourcesPanelProps> = ({
  sources,
  selectedSourceIds,
  onToggleSource,
  onSelectAllSources,
  loading,
  error,
  onRetry,
  uploading,
  uploadError,
  onUploadFiles,
  onToggleCollapse,
  onPreviewSource,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTopic, setSelectedTopic] = useState<string>('all');
  const [topicMenuOpen, setTopicMenuOpen] = useState(false);
  const [modeLabel, setModeLabel] = useState<'Fast research' | 'Deep context'>(
    'Fast research'
  );

  // Inline "Create note" drawer state
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteTopic, setNoteTopic] = useState('');
  const [noteContent, setNoteContent] = useState('');

  const triggerFilePicker = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      await onUploadFiles(files);
      e.target.value = '';
    }
  };

  const handleCreateNoteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteContent.trim()) return;
    const cleanTitle = noteTitle.trim() || 'Class Notes';
    const slug = cleanTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const markdownBody = `# ${cleanTitle}\n\n${noteContent.trim()}\n`;
    const file = new File([markdownBody], `${slug || 'note'}.md`, {
      type: 'text/markdown',
    });

    await onUploadFiles([file], {
      title: cleanTitle,
      topic: noteTopic.trim() || 'notes',
    });

    setNoteTitle('');
    setNoteTopic('');
    setNoteContent('');
    setNoteOpen(false);
  };

  // Unique topics for filter chip
  const topics = Array.from(
    new Set(sources.map((s) => s.topic).filter(Boolean))
  );

  const filteredSources = sources.filter((s) => {
    const matchesTopic =
      selectedTopic === 'all' || s.topic === selectedTopic;
    if (!matchesTopic) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      s.title.toLowerCase().includes(q) ||
      s.filename.toLowerCase().includes(q) ||
      s.topic.toLowerCase().includes(q)
    );
  });

  const allSelected =
    sources.length > 0 && selectedSourceIds.length === sources.length;

  return (
    <aside className="w-full min-w-0 flex flex-col p-4 sm:p-5 rounded-panel bg-surface border border-border select-none justify-between overflow-y-auto overflow-x-hidden thin-scrollbar h-full">
      {/* Hidden file input for POST /ingest */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.md,.txt"
        multiple
        onChange={handleFileChange}
        className="hidden"
      />

      <div className="flex-shrink-0 min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 mb-4">
          <span className="text-[18px] font-semibold text-ink tracking-tight truncate">
            Sources
          </span>
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Collapse sources panel"
            title="Collapse Sources panel"
            className="hidden md:flex w-7 h-7 rounded-md items-center justify-center text-ink-muted hover:text-ink hover:bg-surface-muted transition-colors border border-transparent hover:border-border flex-shrink-0"
          >
            <span className="material-symbols-outlined text-[18px]">
              dock_to_left
            </span>
          </button>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-2 mb-4">
          <button
            type="button"
            disabled={uploading}
            onClick={triggerFilePicker}
            className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg text-[13px] font-medium text-ink bg-surface border border-border hover:bg-surface-muted disabled:opacity-60 transition-colors min-w-0"
          >
            <span className="material-symbols-outlined text-[16px] text-ink-muted flex-shrink-0">
              {uploading ? 'hourglass_top' : 'add'}
            </span>
            <span className="truncate">
              {uploading ? 'Uploading...' : 'Add sources'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setNoteOpen((prev) => !prev)}
            className={`flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg text-[13px] font-medium border transition-colors min-w-0 ${
              noteOpen
                ? 'bg-accent-soft text-accent border-accent/30'
                : 'text-ink bg-surface border-border hover:bg-surface-muted'
            }`}
          >
            <span className="material-symbols-outlined text-[16px] text-ink-muted flex-shrink-0">
              edit_note
            </span>
            <span className="truncate">Create note</span>
          </button>
        </div>

        {/* Upload status / error feedback */}
        {uploadError && (
          <div className="mb-3 p-2.5 rounded-lg bg-danger-soft border border-danger-border text-[12px] text-danger flex items-start justify-between gap-2 break-words">
            <span>{uploadError}</span>
          </div>
        )}

        {/* Inline "Create note" form */}
        {noteOpen && (
          <form
            onSubmit={handleCreateNoteSubmit}
            className="mb-4 p-3 rounded-xl bg-surface-muted border border-border flex flex-col gap-2"
          >
            <div className="flex items-center justify-between gap-1">
              <span className="text-[12px] font-semibold text-ink truncate">
                New Markdown Note
              </span>
              <button
                type="button"
                onClick={() => setNoteOpen(false)}
                className="text-ink-muted hover:text-ink flex-shrink-0"
              >
                <span className="material-symbols-outlined text-[15px]">
                  close
                </span>
              </button>
            </div>
            <input
              type="text"
              placeholder="Note title (e.g. Few-shot examples)"
              value={noteTitle}
              onChange={(e) => setNoteTitle(e.target.value)}
              className="w-full rounded-md bg-surface border border-border px-2.5 py-1.5 text-[12px] text-ink placeholder-ink-muted focus:outline-none focus:border-accent min-w-0"
            />
            <input
              type="text"
              placeholder="Topic tag (optional)"
              value={noteTopic}
              onChange={(e) => setNoteTopic(e.target.value)}
              className="w-full rounded-md bg-surface border border-border px-2.5 py-1.5 text-[12px] text-ink placeholder-ink-muted focus:outline-none focus:border-accent min-w-0"
            />
            <textarea
              rows={3}
              required
              placeholder="Paste or type lecture notes to index..."
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              className="w-full rounded-md bg-surface border border-border px-2.5 py-1.5 text-[12px] text-ink placeholder-ink-muted focus:outline-none focus:border-accent resize-none min-w-0"
            />
            <div className="flex justify-end gap-1.5 pt-1 flex-wrap">
              <button
                type="button"
                onClick={() => setNoteOpen(false)}
                className="px-2.5 py-1 rounded-md text-[12px] font-medium text-ink-muted hover:text-ink"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={uploading || !noteContent.trim()}
                className="px-3 py-1 rounded-full bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-[12px] font-medium transition-colors"
              >
                {uploading ? 'Saving...' : 'Save source'}
              </button>
            </div>
          </form>
        )}

        {/* Search Container & Filter Chips */}
        <div className="flex flex-col gap-2.5 mb-4">
          <div className="flex items-center rounded-lg bg-surface-muted border border-border px-3 py-2 focus-within:border-accent focus-within:bg-surface transition-colors min-w-0">
            <span className="material-symbols-outlined text-[18px] text-ink-muted mr-2 flex-shrink-0">
              search
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search the web for new sources"
              className="bg-transparent border-0 text-[13px] text-ink placeholder-ink-muted focus:outline-none flex-1 min-w-0"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="text-ink-muted hover:text-ink ml-1 flex-shrink-0"
              >
                <span className="material-symbols-outlined text-[15px]">
                  close
                </span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 flex-wrap relative">
            <div className="relative">
              <button
                type="button"
                onClick={() => setTopicMenuOpen((o) => !o)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-muted text-ink-muted hover:text-ink border border-border text-[12px] font-medium transition-colors"
              >
                <span className="truncate max-w-[110px]">
                  {selectedTopic === 'all' ? 'Web' : selectedTopic}
                </span>
                <span className="material-symbols-outlined text-[13px] flex-shrink-0">
                  expand_more
                </span>
              </button>

              {topicMenuOpen && (
                <div className="absolute left-0 mt-1 w-44 rounded-xl bg-surface border border-border py-1 z-30">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedTopic('all');
                      setTopicMenuOpen(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 text-[12px] hover:bg-surface-muted flex items-center justify-between ${
                      selectedTopic === 'all'
                        ? 'text-accent font-medium'
                        : 'text-ink'
                    }`}
                  >
                    <span>All sources (Web)</span>
                    {selectedTopic === 'all' && (
                      <span className="material-symbols-outlined text-[14px]">
                        check
                      </span>
                    )}
                  </button>
                  {topics.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        setSelectedTopic(t);
                        setTopicMenuOpen(false);
                      }}
                      className={`w-full text-left px-3 py-1.5 text-[12px] hover:bg-surface-muted flex items-center justify-between ${
                        selectedTopic === t
                          ? 'text-accent font-medium'
                          : 'text-ink'
                      }`}
                    >
                      <span className="truncate">{t}</span>
                      {selectedTopic === t && (
                        <span className="material-symbols-outlined text-[14px]">
                          check
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() =>
                setModeLabel((m) =>
                  m === 'Fast research' ? 'Deep context' : 'Fast research'
                )
              }
              className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-muted text-ink-muted hover:text-ink border border-border text-[12px] font-medium transition-colors"
            >
              <span className="truncate">{modeLabel}</span>
              <span className="material-symbols-outlined text-[13px] flex-shrink-0">
                expand_more
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area: Loading / Error / Empty / Source List */}
      {loading ? (
        <div className="flex-1 flex flex-col justify-center items-center text-center px-3 py-6 border border-dashed border-border rounded-xl bg-surface-muted/60 min-h-[180px]">
          <div className="w-8 h-8 rounded-full border-2 border-border border-t-accent animate-spin mb-3" />
          <p className="text-[13px] font-medium text-ink">Loading sources...</p>
          <p className="text-[12px] text-ink-muted mt-0.5">
            Fetching indexed documents
          </p>
        </div>
      ) : error ? (
        <div className="flex-1 flex flex-col justify-center items-center text-center px-3 py-6 border border-dashed border-border rounded-xl bg-surface-muted/60 min-h-[180px]">
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-danger mb-3 bg-surface border border-border">
            <span className="material-symbols-outlined text-[20px]">
              cloud_off
            </span>
          </div>
          <h4 className="text-[14px] font-semibold text-ink tracking-tight mb-1 break-words">
            Couldn't reach the server.
          </h4>
          <p className="text-[12px] leading-relaxed text-ink-muted mb-3 max-w-[210px] break-words">
            {error}
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="px-3.5 py-1.5 rounded-full bg-accent hover:bg-accent-hover text-white text-[12px] font-medium transition-colors"
          >
            Retry
          </button>
        </div>
      ) : sources.length === 0 ? (
        /* Empty State matching screen.png & code.html */
        <div className="flex-1 flex flex-col justify-center items-center text-center px-2 py-6 border border-dashed border-border rounded-xl bg-surface-muted/60 min-h-[180px]">
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-ink-muted mb-3 bg-surface border border-border">
            <span className="material-symbols-outlined text-[20px]">
              description
            </span>
          </div>
          <h4 className="text-[14px] font-semibold text-ink tracking-tight mb-1 break-words">
            Saved sources will appear here
          </h4>
          <p className="text-[12px] leading-relaxed text-ink-muted mb-3 max-w-[210px] break-words">
            Add papers, guides, slides or notes to ground your lesson.
          </p>
          <button
            type="button"
            onClick={triggerFilePicker}
            className="text-[13px] font-medium text-accent hover:text-accent-hover hover:underline"
          >
            Add a source
          </button>
        </div>
      ) : (
        /* Populated Sources List with Checkboxes setting settings.source_ids */
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="flex items-center justify-between gap-2 pb-2 mb-2 border-b border-border text-[12px] text-ink-muted flex-wrap">
            <label className="inline-flex items-center gap-2 cursor-pointer hover:text-ink min-w-0">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={(e) => onSelectAllSources(e.target.checked)}
                className="w-4 h-4 rounded border-border text-accent focus:ring-0 focus:ring-offset-0 cursor-pointer accent-[#0D9488] flex-shrink-0"
              />
              <span className="truncate">
                Select all ({selectedSourceIds.length}/{sources.length})
              </span>
            </label>
            <button
              type="button"
              onClick={triggerFilePicker}
              className="text-accent hover:text-accent-hover font-medium flex-shrink-0"
            >
              + Upload
            </button>
          </div>

          <div className="flex-1 overflow-y-auto thin-scrollbar space-y-2 pr-0.5 min-w-0">
            {filteredSources.length === 0 ? (
              <div className="py-8 text-center text-[12px] text-ink-muted break-words">
                No sources match “{searchQuery}”.
              </div>
            ) : (
              filteredSources.map((source) => {
                const isChecked = selectedSourceIds.includes(source.id);
                return (
                  <div
                    key={source.id}
                    onClick={() => onToggleSource(source.id)}
                    className={`group flex items-start gap-2.5 p-2.5 rounded-xl border transition-colors cursor-pointer min-w-0 ${
                      isChecked
                        ? 'bg-surface border-border hover:border-border-strong'
                        : 'bg-surface-muted/60 border-border opacity-75 hover:opacity-100'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => onToggleSource(source.id)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Select ${source.title}`}
                      className="mt-0.5 w-4 h-4 rounded border-border text-accent focus:ring-0 focus:ring-offset-0 cursor-pointer accent-[#0D9488] flex-shrink-0"
                    />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-1 min-w-0">
                        <p className="text-[13px] font-medium text-ink leading-snug break-words min-w-0">
                          {source.title}
                        </p>
                        {onPreviewSource && (
                          <button
                            type="button"
                            title="Preview indexed chunks"
                            onClick={(e) => {
                              e.stopPropagation();
                              const rect =
                                e.currentTarget.getBoundingClientRect();
                              onPreviewSource({
                                n: 1,
                                sourceId: source.id,
                                title: source.title,
                                page: 1,
                                url: source.url,
                                anchorRect: {
                                  top: rect.top,
                                  left: rect.right + 8,
                                  bottom: rect.bottom,
                                  width: rect.width,
                                },
                              });
                            }}
                            className="opacity-0 group-hover:opacity-100 text-ink-muted hover:text-accent p-0.5 rounded transition-opacity flex-shrink-0"
                          >
                            <span className="material-symbols-outlined text-[15px]">
                              visibility
                            </span>
                          </button>
                        )}
                      </div>

                      <div className="flex items-center flex-wrap gap-1.5 mt-1 text-[11px] text-ink-muted">
                        {source.topic && (
                          <span className="px-1.5 py-0.2 rounded bg-surface-muted border border-border text-[10px] font-medium truncate max-w-full">
                            {source.topic}
                          </span>
                        )}
                        <span>
                          {source.pages}p · {source.chunk_count} chunks
                        </span>
                        {source.url && (
                          <a
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-accent hover:underline inline-flex items-center"
                            title={source.url}
                          >
                            <span className="material-symbols-outlined text-[12px]">
                              open_in_new
                            </span>
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </aside>
  );
};
