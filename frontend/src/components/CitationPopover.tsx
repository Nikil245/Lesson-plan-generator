import React, { useEffect, useRef, useState } from 'react';
import { fetchSourceDetail, SourceChunk, SourceDetail } from '../api/client';
import { ActiveCitationTarget } from './CitationText';

interface CitationPopoverProps {
  citation: ActiveCitationTarget | null;
  onClose: () => void;
}

export const CitationPopover: React.FC<CitationPopoverProps> = ({
  citation,
  onClose,
}) => {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [detail, setDetail] = useState<SourceDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAllChunks, setShowAllChunks] = useState(false);

  useEffect(() => {
    if (!citation) {
      setDetail(null);
      setError(null);
      setShowAllChunks(false);
      return;
    }

    if (!citation.sourceId) {
      setDetail(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setShowAllChunks(false);

    fetchSourceDetail(citation.sourceId)
      .then((doc) => {
        if (!cancelled) {
          setDetail(doc);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Couldn't load source chunks."
          );
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [citation]);

  useEffect(() => {
    if (!citation) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousedown', handleClickOutside);
    };
  }, [citation, onClose]);

  if (!citation) return null;

  // Match the best chunk from GET /sources/{id} for the cited page/excerpt
  const matchingChunks: SourceChunk[] = detail
    ? detail.chunks.filter((c) => c.page === citation.page)
    : [];

  const bestChunk: SourceChunk | undefined = (() => {
    if (!detail || detail.chunks.length === 0) return undefined;
    if (citation.excerpt) {
      const needle = citation.excerpt.slice(0, 60).trim();
      const exactMatch = detail.chunks.find((c) => c.text.includes(needle));
      if (exactMatch) return exactMatch;
    }
    return matchingChunks[0] || detail.chunks[0];
  })();

  const displayTitle = detail?.title || citation.title;
  const displayUrl = detail?.url || citation.url;
  const displayExcerpt =
    citation.excerpt ||
    (bestChunk ? bestChunk.text.slice(0, 320) : 'No excerpt available.');

  // Position calculation so popover stays within viewport
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
  const popoverWidth = Math.min(380, viewportWidth - 24);

  let left = citation.anchorRect.left;
  if (left + popoverWidth > viewportWidth - 16) {
    left = Math.max(12, viewportWidth - popoverWidth - 16);
  }

  const placeAbove = citation.anchorRect.bottom + 300 > viewportHeight;
  const top = placeAbove
    ? Math.max(12, citation.anchorRect.top - 8)
    : Math.min(viewportHeight - 260, citation.anchorRect.bottom + 8);

  return (
    <div
      ref={popoverRef}
      style={{
        position: 'fixed',
        top: `${top}px`,
        left: `${left}px`,
        width: `${popoverWidth}px`,
        transform: placeAbove ? 'translateY(-100%)' : 'none',
        zIndex: 60,
      }}
      className="rounded-panel bg-surface border border-border p-4 text-ink select-text"
      role="dialog"
      aria-label={`Citation ${citation.n}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2.5 mb-2.5">
        <div className="flex items-start gap-2 min-w-0">
          <span className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full bg-accent text-white text-[12px] font-semibold flex-shrink-0 mt-0.5">
            [{citation.n}]
          </span>
          <div className="min-w-0">
            <h4 className="text-[13px] font-semibold text-ink leading-snug break-words">
              {displayTitle}
            </h4>
            <div className="flex items-center flex-wrap gap-1.5 mt-1">
              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-surface-muted border border-border text-[11px] font-medium text-ink-muted">
                Page {citation.page}
              </span>
              {detail?.topic && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-surface-muted border border-border text-[11px] font-medium text-ink-muted">
                  {detail.topic}
                </span>
              )}
              {detail && (
                <span className="text-[11px] text-ink-muted">
                  {detail.chunk_count} chunk{detail.chunk_count === 1 ? '' : 's'}
                </span>
              )}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close citation popover"
          className="w-6 h-6 rounded-md flex items-center justify-center text-ink-muted hover:text-ink hover:bg-surface-muted transition-colors flex-shrink-0"
        >
          <span className="material-symbols-outlined text-[16px]">close</span>
        </button>
      </div>

      {/* Excerpt / Chunks content */}
      <div className="rounded-lg bg-surface-muted border border-border p-3 max-h-56 overflow-y-auto thin-scrollbar">
        {loading ? (
          <div className="space-y-2 py-1">
            <p className="text-[12px] text-ink leading-relaxed">
              “{displayExcerpt}”
            </p>
            <div className="flex items-center gap-1.5 text-[11px] text-ink-muted pt-1 border-t border-border">
              <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
              <span>Loading full passage from source...</span>
            </div>
          </div>
        ) : error ? (
          <div className="space-y-2">
            <p className="text-[12px] text-ink leading-relaxed">
              “{displayExcerpt}”
            </p>
            <p className="text-[11px] text-danger pt-1 border-t border-border">
              {error}
            </p>
          </div>
        ) : showAllChunks && detail ? (
          <div className="space-y-2.5">
            {(matchingChunks.length > 0 ? matchingChunks : detail.chunks).map(
              (chunk) => (
                <div
                  key={chunk.id}
                  className="pb-2.5 last:pb-0 border-b last:border-b-0 border-border"
                >
                  <div className="flex items-center justify-between text-[11px] font-medium text-ink-muted mb-1">
                    <span>
                      Page {chunk.page} · Chunk #{chunk.chunk_index + 1}
                    </span>
                  </div>
                  <p className="text-[12px] text-ink leading-relaxed whitespace-pre-wrap">
                    {chunk.text}
                  </p>
                </div>
              )
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-[12px] text-ink leading-relaxed whitespace-pre-wrap">
              “{bestChunk ? bestChunk.text : displayExcerpt}”
            </p>
          </div>
        )}
      </div>

      {/* Footer with chunk toggle & external source link */}
      <div className="flex items-center justify-between gap-2 mt-2.5 pt-2 border-t border-border">
        <div className="flex items-center gap-2 min-w-0">
          {detail && detail.chunks.length > 1 && (
            <button
              type="button"
              onClick={() => setShowAllChunks((v) => !v)}
              className="text-[11px] font-medium text-ink-muted hover:text-ink transition-colors"
            >
              {showAllChunks
                ? 'Show cited passage'
                : `View page passages (${
                    matchingChunks.length || detail.chunks.length
                  })`}
            </button>
          )}
          {!detail && citation.sourceId && (
            <span className="text-[11px] text-ink-muted truncate">
              ID: {citation.sourceId}
            </span>
          )}
        </div>

        {displayUrl ? (
          <a
            href={displayUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:text-accent-hover hover:underline flex-shrink-0"
          >
            <span>Open source</span>
            <span className="material-symbols-outlined text-[14px]">
              open_in_new
            </span>
          </a>
        ) : (
          <span className="text-[11px] text-ink-muted truncate">
            {detail?.filename || 'Uploaded document'}
          </span>
        )}
      </div>
    </div>
  );
};

