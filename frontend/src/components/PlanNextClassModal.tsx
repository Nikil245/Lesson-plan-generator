import React, { useEffect, useMemo, useState } from 'react';
import {
  CourseDetail,
  CourseTopic,
  createCourseLesson,
  CreateCourseLessonResult,
} from '../api/client';

interface PlanNextClassModalProps {
  open: boolean;
  course: CourseDetail;
  onClose: () => void;
  onCreated: (result: CreateCourseLessonResult) => void;
}

const DURATION_PRESETS = [30, 45, 60, 90, 120];
const LEVEL_OPTIONS = [
  { label: 'Beginner', value: 'beginner' },
  { label: 'Intermediate', value: 'intermediate' },
  { label: 'Advanced', value: 'advanced' },
];
const AUDIENCE_SUGGESTIONS = [
  'university students',
  'high school students',
  'software engineers',
  'working professionals',
];

/**
 * Mirrors backend/app/courses.py `select_next_topics()` (~85% of duration_min)
 * so the teacher sees an accurate preview before generating.
 */
function previewTopicIds(topics: CourseTopic[], durationMin: number): string[] {
  const pending = topics.filter((t) => t.status === 'not_started');
  if (pending.length === 0) return [];

  const target = durationMin * 0.85;
  const selected: CourseTopic[] = [];
  let total = 0;

  for (const topic of pending) {
    const est = topic.est_minutes;
    if (selected.length === 0) {
      selected.push(topic);
      total += est;
      continue;
    }
    if (total + est <= target) {
      selected.push(topic);
      total += est;
    } else if (
      total + est <= durationMin &&
      Math.abs(total + est - target) < Math.abs(total - target)
    ) {
      selected.push(topic);
      total += est;
      break;
    } else {
      break;
    }
  }
  return selected.map((t) => t.id);
}

export const PlanNextClassModal: React.FC<PlanNextClassModalProps> = ({
  open,
  course,
  onClose,
  onCreated,
}) => {
  const [durationMin, setDurationMin] = useState<number>(60);
  const [level, setLevel] = useState<string>('beginner');
  const [audience, setAudience] = useState<string>('university students');
  const [objectives, setObjectives] = useState<string[]>([]);
  const [objectiveDraft, setObjectiveDraft] = useState<string>('');
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([]);
  const [userCustomizedTopics, setUserCustomizedTopics] =
    useState<boolean>(false);
  const [showAllTopics, setShowAllTopics] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const pendingTopics = useMemo(
    () => course.topics.filter((t) => t.status === 'not_started'),
    [course.topics]
  );

  const defaultPreviewIds = useMemo(
    () => previewTopicIds(course.topics, durationMin),
    [course.topics, durationMin]
  );

  // Reset form each time modal opens
  useEffect(() => {
    if (!open) return;
    setDurationMin(60);
    setLevel('beginner');
    setAudience('university students');
    setObjectives([]);
    setObjectiveDraft('');
    setUserCustomizedTopics(false);
    setShowAllTopics(pendingTopics.length === 0);
    setSelectedTopicIds(previewTopicIds(course.topics, 60));
    setError(null);
  }, [open, course.topics, pendingTopics.length]);

  // Keep default preview synced when duration changes unless teacher manually edited ticks
  useEffect(() => {
    if (!open || userCustomizedTopics) return;
    setSelectedTopicIds(defaultPreviewIds);
  }, [open, defaultPreviewIds, userCustomizedTopics]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, submitting, onClose]);

  if (!open) return null;

  const nextClassNum =
    course.lessons.length > 0
      ? course.lessons[course.lessons.length - 1].seq + 1
      : 1;

  const selectedTopics = course.topics.filter((t) =>
    selectedTopicIds.includes(t.id)
  );
  const selectedMinutes = selectedTopics.reduce(
    (sum, t) => sum + t.est_minutes,
    0
  );
  const fillPct =
    durationMin > 0 ? Math.round((selectedMinutes / durationMin) * 100) : 0;

  // Show the auto-previewed topics (plus any ticked ones) by default; allow expanding to all pending/course topics
  const visibleTopics = showAllTopics
    ? course.topics
    : pendingTopics.filter(
        (t) =>
          defaultPreviewIds.includes(t.id) || selectedTopicIds.includes(t.id)
      );

  const toggleTopic = (topicId: string) => {
    setUserCustomizedTopics(true);
    setSelectedTopicIds((prev) =>
      prev.includes(topicId)
        ? prev.filter((id) => id !== topicId)
        : [...prev, topicId]
    );
  };

  const handleAddObjective = () => {
    const trimmed = objectiveDraft.trim();
    if (!trimmed) return;
    setObjectives((prev) => [...prev, trimmed]);
    setObjectiveDraft('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedTopicIds.length === 0 || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      const sameAsDefault =
        !userCustomizedTopics &&
        selectedTopicIds.length === defaultPreviewIds.length &&
        selectedTopicIds.every((id) => defaultPreviewIds.includes(id));

      const result = await createCourseLesson(course.id, {
        duration_min: durationMin,
        level,
        audience: audience.trim() || 'university students',
        objectives: objectives.length > 0 ? objectives : undefined,
        // Omit topic_ids when unchanged so backend auto-picks; send explicit list when customized
        topic_ids: sameAsDefault ? undefined : selectedTopicIds,
      });
      onCreated(result);
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not generate class lesson plan. Please try again.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="plan-next-class-title"
      className="fixed inset-0 z-50 bg-ink/20 flex items-center justify-center p-4"
      onClick={() => {
        if (!submitting) onClose();
      }}
    >
      <div
        className="w-full max-w-xl rounded-[20px] bg-surface border border-border p-5 sm:p-6 space-y-4 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 flex-shrink-0">
          <div>
            <h2
              id="plan-next-class-title"
              className="text-[16px] font-semibold text-ink tracking-tight"
            >
              Plan Class {nextClassNum}
            </h2>
            <p className="text-[13px] text-ink-muted mt-0.5">
              Review the topics that fit your class time, untick any to skip, and
              generate a cited plan.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close plan next class dialog"
            disabled={submitting}
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-ink-muted hover:text-ink hover:bg-surface-muted transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex-1 min-h-0 flex flex-col gap-4 overflow-y-auto thin-scrollbar pr-0.5"
        >
          {/* Duration, Level, Audience */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label
                htmlFor="plan-duration"
                className="block text-[12px] font-semibold uppercase tracking-wider text-ink-muted"
              >
                Duration (min)
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  id="plan-duration"
                  type="number"
                  min={15}
                  max={240}
                  step={5}
                  value={durationMin}
                  disabled={submitting}
                  onChange={(e) => {
                    const v = Math.max(15, Math.min(240, Number(e.target.value) || 60));
                    setDurationMin(v);
                    setUserCustomizedTopics(false);
                  }}
                  className="w-full px-3 py-1.5 rounded-xl bg-surface-muted border border-border focus:border-accent text-[13px] text-ink focus:outline-none"
                />
              </div>
              <div className="flex items-center gap-1 flex-wrap pt-0.5">
                {DURATION_PRESETS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    disabled={submitting}
                    onClick={() => {
                      setDurationMin(m);
                      setUserCustomizedTopics(false);
                    }}
                    className={`px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors ${
                      durationMin === m
                        ? 'bg-accent-soft text-accent border-accent/30'
                        : 'bg-surface text-ink-muted border-border hover:border-border-strong'
                    }`}
                  >
                    {m}m
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <label
                htmlFor="plan-level"
                className="block text-[12px] font-semibold uppercase tracking-wider text-ink-muted"
              >
                Level
              </label>
              <select
                id="plan-level"
                value={level}
                disabled={submitting}
                onChange={(e) => setLevel(e.target.value)}
                className="w-full px-3 py-1.5 rounded-xl bg-surface-muted border border-border focus:border-accent text-[13px] text-ink focus:outline-none"
              >
                {LEVEL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label
                htmlFor="plan-audience"
                className="block text-[12px] font-semibold uppercase tracking-wider text-ink-muted"
              >
                Audience
              </label>
              <input
                id="plan-audience"
                type="text"
                list="plan-audience-list"
                value={audience}
                disabled={submitting}
                onChange={(e) => setAudience(e.target.value)}
                placeholder="university students"
                className="w-full px-3 py-1.5 rounded-xl bg-surface-muted border border-border focus:border-accent text-[13px] text-ink focus:outline-none"
              />
              <datalist id="plan-audience-list">
                {AUDIENCE_SUGGESTIONS.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </div>
          </div>

          {/* Optional Objectives */}
          <div className="space-y-1.5">
            <label
              htmlFor="plan-objective-input"
              className="block text-[12px] font-semibold uppercase tracking-wider text-ink-muted"
            >
              Objectives (optional)
            </label>
            <div className="flex items-center gap-2">
              <input
                id="plan-objective-input"
                type="text"
                value={objectiveDraft}
                disabled={submitting}
                onChange={(e) => setObjectiveDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddObjective();
                  }
                }}
                placeholder="Add a learning objective and press Enter"
                className="flex-1 px-3 py-1.5 rounded-xl bg-surface-muted border border-border focus:border-accent text-[13px] text-ink placeholder-ink-muted focus:outline-none"
              />
              <button
                type="button"
                disabled={submitting || !objectiveDraft.trim()}
                onClick={handleAddObjective}
                className="px-3 py-1.5 rounded-full bg-surface border border-border hover:border-border-strong text-[12px] font-medium text-ink disabled:opacity-40 transition-colors"
              >
                Add
              </button>
            </div>
            {objectives.length > 0 && (
              <div className="flex items-center flex-wrap gap-1.5 pt-1">
                {objectives.map((obj, idx) => (
                  <span
                    key={`${obj}-${idx}`}
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-accent-soft text-accent border border-accent/25 text-[11px] font-medium"
                  >
                    <span>{obj}</span>
                    <button
                      type="button"
                      aria-label={`Remove objective ${obj}`}
                      onClick={() =>
                        setObjectives((prev) => prev.filter((_, i) => i !== idx))
                      }
                      className="hover:text-accent-hover"
                    >
                      <span className="material-symbols-outlined text-[13px]">
                        close
                      </span>
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Topic preview with untick option */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-[12px] font-semibold uppercase tracking-wider text-ink-muted">
                Topics to include ({selectedTopicIds.length})
              </span>
              <div className="flex items-center gap-2.5 text-[12px]">
                <span className="text-ink-muted">
                  ~{selectedMinutes} / {durationMin} min ({fillPct}%)
                </span>
                <button
                  type="button"
                  onClick={() => setShowAllTopics((v) => !v)}
                  className="text-accent hover:text-accent-hover font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded px-1"
                >
                  {showAllTopics ? 'Show suggested only' : 'Show all topics'}
                </button>
              </div>
            </div>

            {pendingTopics.length === 0 && !showAllTopics ? (
              <div className="p-4 rounded-xl bg-surface-muted border border-border text-center text-[13px] text-ink-muted">
                All syllabus topics are already planned or taught. Click{' '}
                <button
                  type="button"
                  onClick={() => setShowAllTopics(true)}
                  className="text-accent font-medium hover:underline"
                >
                  Show all topics
                </button>{' '}
                to select topics manually.
              </div>
            ) : (
              <div className="max-h-[210px] overflow-y-auto thin-scrollbar rounded-xl border border-border bg-surface-muted/50 p-2 space-y-1.5">
                {visibleTopics.map((topic) => {
                  const checked = selectedTopicIds.includes(topic.id);
                  return (
                    <label
                      key={topic.id}
                      className={`flex items-start gap-2.5 p-2.5 rounded-xl border cursor-pointer transition-colors ${
                        checked
                          ? 'bg-accent-soft/50 border-accent'
                          : 'bg-surface border-border hover:border-border-strong'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={submitting}
                        onChange={() => toggleTopic(topic.id)}
                        aria-label={`Include topic ${topic.title}`}
                        className="mt-0.5 w-4 h-4 rounded border-border accent-[#0D9488] cursor-pointer flex-shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[13px] font-medium text-ink truncate">
                            {topic.position}. {topic.title}
                          </span>
                          <span className="text-[11px] font-mono text-ink-muted flex-shrink-0">
                            pp. {topic.page_start}–{topic.page_end} ·{' '}
                            {topic.est_minutes}m
                          </span>
                        </div>
                        {topic.summary && (
                          <p className="text-[11px] text-ink-muted mt-0.5 line-clamp-1">
                            {topic.summary}
                          </p>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {submitting && (
            <div
              role="status"
              className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-accent-soft border border-accent/25 text-[13px] text-accent"
            >
              <div className="w-4 h-4 rounded-full border-2 border-accent/30 border-t-accent animate-spin flex-shrink-0" />
              <span>
                Generating Class {nextClassNum} from selected pages…
              </span>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="px-3.5 py-2.5 rounded-xl bg-danger-soft border border-danger-border text-[13px] text-danger"
            >
              {error}
            </div>
          )}

          {/* Footer actions */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border flex-shrink-0">
            <button
              type="button"
              disabled={submitting}
              onClick={onClose}
              className="px-4 py-1.5 rounded-full border border-border text-[13px] font-medium text-ink-muted hover:text-ink hover:bg-surface-muted transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={selectedTopicIds.length === 0 || submitting}
              className="px-4 py-1.5 rounded-full bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            >
              {submitting ? 'Generating plan…' : `Generate Class ${nextClassNum}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

