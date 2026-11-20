import React, { useEffect, useRef, useState } from 'react';
import {
  CourseDetail,
  createCourse,
  fetchSources,
  ingestSource,
  SourceSummary,
} from '../api/client';

interface NewCourseModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (course: CourseDetail) => void;
}

export const NewCourseModal: React.FC<NewCourseModalProps> = ({
  open,
  onClose,
  onCreated,
}) => {
  const [title, setTitle] = useState('');
  const [sources, setSources] = useState<SourceSummary[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const titleInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadSources = async () => {
    setSourcesLoading(true);
    setSourcesError(null);
    try {
      const list = await fetchSources();
      setSources(list);
    } catch (err: unknown) {
      setSourcesError(
        err instanceof Error ? err.message : "Couldn't load sources from server."
      );
    } finally {
      setSourcesLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setSelectedIds([]);
    setUploadError(null);
    setSubmitError(null);
    loadSources();
    const timer = window.setTimeout(() => titleInputRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting && !uploading) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, submitting, uploading, onClose]);

  if (!open) return null;

  const toggleSource = (source: SourceSummary) => {
    setSelectedIds((prev) => {
      const exists = prev.includes(source.id);
      const next = exists
        ? prev.filter((id) => id !== source.id)
        : [...prev, source.id];
      if (!exists && !title.trim()) {
        setTitle(source.title);
      }
      return next;
    });
  };

  const handleUploadPdf = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setUploading(true);
    setUploadError(null);
    try {
      const result = await ingestSource(file);
      const refreshed = await fetchSources();
      setSources(refreshed);
      setSelectedIds((prev) =>
        prev.includes(result.source_id) ? prev : [...prev, result.source_id]
      );
      if (!title.trim()) {
        setTitle(result.title || file.name.replace(/\.[^.]+$/, ''));
      }
    } catch (err: unknown) {
      setUploadError(
        err instanceof Error ? err.message : 'Could not upload and index file.'
      );
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle || selectedIds.length === 0 || submitting) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const created = await createCourse({
        title: trimmedTitle,
        source_ids: selectedIds,
      });
      onCreated(created);
    } catch (err: unknown) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : 'Could not create course. Please try again.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit =
    title.trim().length >= 2 && selectedIds.length > 0 && !submitting && !uploading;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-course-dialog-title"
      className="fixed inset-0 z-50 bg-ink/20 flex items-center justify-center p-4"
      onClick={() => {
        if (!submitting && !uploading) onClose();
      }}
    >
      <div
        className="w-full max-w-lg rounded-[20px] bg-surface border border-border p-5 sm:p-6 space-y-5 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 flex-shrink-0">
          <div>
            <h2
              id="new-course-dialog-title"
              className="text-[16px] font-semibold text-ink tracking-tight"
            >
              New course
            </h2>
            <p className="text-[13px] text-ink-muted mt-0.5">
              Choose a source or upload a PDF to build an ordered syllabus.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close new course dialog"
            disabled={submitting || uploading}
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-ink-muted hover:text-ink hover:bg-surface-muted transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex-1 min-h-0 flex flex-col gap-4 overflow-hidden"
        >
          {/* Course title */}
          <div className="space-y-1.5 flex-shrink-0">
            <label
              htmlFor="new-course-title"
              className="block text-[12px] font-semibold uppercase tracking-wider text-ink-muted"
            >
              Course title
            </label>
            <input
              ref={titleInputRef}
              id="new-course-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Prompt Engineering Foundations"
              disabled={submitting}
              required
              minLength={2}
              className="w-full px-3.5 py-2 rounded-xl bg-surface-muted border border-border focus:border-accent text-[14px] text-ink placeholder-ink-muted focus:outline-none transition-colors"
            />
          </div>

          {/* Sources selection + Upload PDF */}
          <div className="flex-1 min-h-0 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2 flex-shrink-0">
              <span className="text-[12px] font-semibold uppercase tracking-wider text-ink-muted">
                Sources ({selectedIds.length} selected)
              </span>
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.md,.txt"
                  onChange={handleUploadPdf}
                  className="hidden"
                  aria-label="Upload PDF source"
                />
                <button
                  type="button"
                  disabled={uploading || submitting}
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3 py-1 rounded-full bg-surface border border-border hover:border-accent hover:text-accent text-[12px] font-medium text-ink inline-flex items-center gap-1.5 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <span className="material-symbols-outlined text-[15px]">
                    upload_file
                  </span>
                  <span>{uploading ? 'Uploading…' : 'Upload PDF'}</span>
                </button>
              </div>
            </div>

            {uploadError && (
              <div
                role="alert"
                className="px-3 py-2 rounded-xl bg-danger-soft border border-danger-border text-[12px] text-danger"
              >
                {uploadError}
              </div>
            )}

            <div className="flex-1 min-h-[140px] max-h-[240px] overflow-y-auto thin-scrollbar rounded-xl border border-border bg-surface-muted/50 p-2 space-y-1.5">
              {sourcesLoading ? (
                <div className="h-32 flex flex-col items-center justify-center gap-2 text-[13px] text-ink-muted">
                  <div className="w-5 h-5 rounded-full border-2 border-border border-t-accent animate-spin" />
                  <span>Loading sources…</span>
                </div>
              ) : sourcesError ? (
                <div className="h-32 flex flex-col items-center justify-center gap-2 text-center px-3">
                  <p className="text-[13px] text-danger">{sourcesError}</p>
                  <button
                    type="button"
                    onClick={loadSources}
                    className="px-3 py-1 rounded-full border border-border bg-surface text-[12px] font-medium text-ink hover:border-border-strong"
                  >
                    Retry
                  </button>
                </div>
              ) : sources.length === 0 ? (
                <div className="h-32 flex flex-col items-center justify-center text-center px-4">
                  <span className="material-symbols-outlined text-[22px] text-ink-muted mb-1">
                    description
                  </span>
                  <p className="text-[13px] font-medium text-ink">
                    No sources indexed yet
                  </p>
                  <p className="text-[12px] text-ink-muted mt-0.5">
                    Upload a PDF, Markdown, or text file above to get started.
                  </p>
                </div>
              ) : (
                sources.map((src) => {
                  const checked = selectedIds.includes(src.id);
                  return (
                    <label
                      key={src.id}
                      className={`flex items-start gap-2.5 p-2.5 rounded-xl border cursor-pointer transition-colors ${
                        checked
                          ? 'bg-accent-soft/60 border-accent'
                          : 'bg-surface border-border hover:border-border-strong'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={submitting}
                        onChange={() => toggleSource(src)}
                        aria-label={`Select source ${src.title}`}
                        className="mt-0.5 w-4 h-4 rounded border-border accent-[#0D9488] cursor-pointer flex-shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-ink truncate">
                          {src.title}
                        </p>
                        <p className="text-[11px] text-ink-muted">
                          {src.pages} {src.pages === 1 ? 'page' : 'pages'} ·{' '}
                          {src.chunk_count} chunks · {src.filename}
                        </p>
                      </div>
                    </label>
                  );
                })
              )}
            </div>
          </div>

          {/* Submitting status / error */}
          {submitting && (
            <div
              role="status"
              className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-accent-soft border border-accent/25 text-[13px] text-accent"
            >
              <div className="w-4 h-4 rounded-full border-2 border-accent/30 border-t-accent animate-spin flex-shrink-0" />
              <span>Building syllabus from your source material…</span>
            </div>
          )}

          {submitError && (
            <div
              role="alert"
              className="px-3.5 py-2.5 rounded-xl bg-danger-soft border border-danger-border text-[13px] text-danger"
            >
              {submitError}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border flex-shrink-0">
            <button
              type="button"
              disabled={submitting || uploading}
              onClick={onClose}
              className="px-4 py-1.5 rounded-full border border-border text-[13px] font-medium text-ink-muted hover:text-ink hover:bg-surface-muted transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="px-4 py-1.5 rounded-full bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-[13px] font-medium transition-colors inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            >
              <span>{submitting ? 'Creating course…' : 'Create course'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

