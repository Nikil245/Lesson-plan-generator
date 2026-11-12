import React from 'react';
import { Citation, SourceItem } from '../api/client';

export interface ActiveCitationTarget {
  n: number;
  sourceId: string;
  title: string;
  page: number;
  url: string;
  excerpt?: string;
  anchorRect: {
    top: number;
    left: number;
    bottom: number;
    width: number;
  };
}

interface CitationTextProps {
  text: string;
  sources?: SourceItem[];
  citations?: Citation[];
  onSelectCitation: (target: ActiveCitationTarget) => void;
  className?: string;
}

// Matches [1], [2], or grouped citations like [1, 3]
const CITATION_REGEX = /\[(\d+(?:\s*,\s*\d+)*)\]/g;

export const CitationText: React.FC<CitationTextProps> = ({
  text,
  sources = [],
  citations = [],
  onSelectCitation,
  className = '',
}) => {
  if (!text) return null;

  const resolveCitation = (n: number) => {
    const fromSources = sources.find((s) => s.n === n);
    const fromPlan = citations.find((c) => c.n === n);

    return {
      n,
      sourceId: fromSources?.id || fromPlan?.source_id || '',
      title: fromSources?.title || fromPlan?.title || `Source [${n}]`,
      page: fromSources?.page ?? fromPlan?.page ?? 1,
      url: fromSources?.url || fromPlan?.url || '',
      excerpt: fromSources?.excerpt,
    };
  };

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  const regex = new RegExp(CITATION_REGEX.source, 'g');
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const nums = match[1]
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((num) => !Number.isNaN(num));

    nums.forEach((n, idx) => {
      const info = resolveCitation(n);
      parts.push(
        <button
          key={`${match!.index}-${n}-${idx}`}
          type="button"
          title={`${info.title} (p. ${info.page})`}
          onClick={(e) => {
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            onSelectCitation({
              ...info,
              anchorRect: {
                top: rect.top,
                left: rect.left,
                bottom: rect.bottom,
                width: rect.width,
              },
            });
          }}
          className="inline-flex items-center justify-center min-w-[20px] h-[19px] px-1.5 mx-0.5 rounded-full bg-accent-soft text-accent border border-accent/25 hover:bg-accent hover:text-white text-[11px] font-semibold leading-none align-baseline transition-colors cursor-pointer"
        >
          {n}
        </button>
      );
    });

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return <span className={className}>{parts}</span>;
};

