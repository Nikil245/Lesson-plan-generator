import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  addCourseTopic,
  CourseDetail,
  CourseLesson,
  CourseTopic,
  CreateCourseLessonResult,
  deleteCourseLesson,
  deleteCourseTopic,
  fetchCourse,
  fetchCourseProgress,
  TopicStatus,
  updateCourseLessonStatus,
  updateCourseTopic,
} from '../api/client';
import { PlanNextClassModal } from '../components/PlanNextClassModal';
import * as lessonStore from '../lib/lessons';

function formatDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return 'Recent';
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(d);
  } catch {
    return 'Recent';
  }
}

function statusChipStyle(status: TopicStatus): {
  label: string;
  className: string;
  nextStatus: TopicStatus;
} {
  switch (status) {
    case 'taught':
      return {
        label: 'Taught',
        className: 'bg-accent-soft text-accent border-accent/30',
        nextStatus: 'not_started',
      };
    case 'planned':
      return {
        label: 'Planned',
        className: 'bg-surface-muted text-ink border-border-strong/60',
        nextStatus: 'taught',
      };
    case 'not_started':
    default:
      return {
        label: 'Not started',
        className: 'bg-surface-chip text-ink-muted border-border',
        nextStatus: 'planned',
      };
  }
}

export const CoursePage: React.FC = () => {
  const { id: courseId = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // Seed from localStorage cache for fast initial paint; backend is always source of truth
  const [course, setCourse] = useState<CourseDetail | null>(() =>
    courseId ? lessonStore.readCachedCourseDetail(courseId) : null
  );
  const [loading, setLoading] = useState<boolean>(!course);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Syllabus editing state
  const [editingTopicId, setEditingTopicId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editMinutes, setEditMinutes] = useState<number>(15);
  const [savingTopicId, setSavingTopicId] = useState<string | null>(null);

  // Add topic form state
  const [addingTopic, setAddingTopic] = useState(false);
  const [newTopicTitle, setNewTopicTitle] = useState('');
  const [newTopicSummary, setNewTopicSummary] = useState('');
  const [newTopicPageStart, setNewTopicPageStart] = useState<number>(1);
  const [newTopicPageEnd, setNewTopicPageEnd] = useState<number>(1);
  const [newTopicMinutes, setNewTopicMinutes] = useState<number>(15);
  const [submittingNewTopic, setSubmittingNewTopic] = useState(false);

  // Drag-and-drop state
  const [draggingTopicId, setDraggingTopicId] = useState<string | null>(null);
  const [dragOverTopicId, setDragOverTopicId] = useState<string | null>(null);

  // Delete confirmations & lesson toggles
  const [confirmDeleteTopic, setConfirmDeleteTopic] =
    useState<CourseTopic | null>(null);
  const [confirmDeleteLesson, setConfirmDeleteLesson] =
    useState<CourseLesson | null>(null);
  const [togglingLessonId, setTogglingLessonId] = useState<string | null>(null);

  // Plan next class modal
  const [planModalOpen, setPlanModalOpen] = useState(false);

  const loadCourse = useCallback(
    async (showSpinner = false) => {
      if (!courseId) return;
      if (showSpinner) setLoading(true);
      setError(null);
      try {
        const [detail, progress] = await Promise.all([
          fetchCourse(courseId),
          fetchCourseProgress(courseId),
        ]);
        const merged: CourseDetail = { ...detail, progress };
        setCourse(merged);
        lessonStore.writeCachedCourseDetail(merged);
      } catch (err: unknown) {
        setError(
          err instanceof Error
            ? err.message
            : "Couldn't load this course from the server."
        );
      } finally {
        setLoading(false);
      }
    },
    [courseId]
  );

  useEffect(() => {
    const cached = courseId ? lessonStore.readCachedCourseDetail(courseId) : null;
    setCourse(cached);
    loadCourse(!cached);
  }, [courseId, loadCourse]);

  // Suggest sensible next page numbers when opening "Add topic"
  const handleOpenAddTopic = () => {
    const lastPage =
      course && course.topics.length > 0
        ? Math.max(...course.topics.map((t) => t.page_end))
        : 0;
    const nextStart = lastPage + 1;
    setNewTopicTitle('');
    setNewTopicSummary('');
    setNewTopicPageStart(nextStart);
    setNewTopicPageEnd(nextStart);
    setNewTopicMinutes(15);
    setActionError(null);
    setAddingTopic(true);
  };

  const handleSubmitNewTopic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!course || !newTopicTitle.trim() || submittingNewTopic) return;
    setSubmittingNewTopic(true);
    setActionError(null);
    try {
      await addCourseTopic(course.id, {
        title: newTopicTitle.trim(),
        summary: newTopicSummary.trim(),
        page_start: Math.max(1, newTopicPageStart),
        page_end: Math.max(newTopicPageStart, newTopicPageEnd),
        est_minutes: Math.max(5, Math.min(120, newTopicMinutes)),
      });
      setAddingTopic(false);
      await loadCourse(false);
    } catch (err: unknown) {
      setActionError(
        err instanceof Error ? err.message : 'Could not add topic.'
      );
    } finally {
      setSubmittingNewTopic(false);
    }
  };

  const startEditingTopic = (topic: CourseTopic) => {
    setEditingTopicId(topic.id);
    setEditTitle(topic.title);
    setEditMinutes(topic.est_minutes);
    setActionError(null);
  };

  const handleSaveTopicEdit = async (topic: CourseTopic) => {
    if (!course || !editTitle.trim()) return;
    setSavingTopicId(topic.id);
    setActionError(null);
    try {
      await updateCourseTopic(course.id, topic.id, {
        title: editTitle.trim(),
        est_minutes: Math.max(5, Math.min(120, editMinutes)),
      });
      setEditingTopicId(null);
      await loadCourse(false);
    } catch (err: unknown) {
      setActionError(
        err instanceof Error ? err.message : 'Could not save topic changes.'
      );
    } finally {
      setSavingTopicId(null);
    }
  };

  const handleCycleTopicStatus = async (topic: CourseTopic) => {
    if (!course) return;
    const nextStatus = statusChipStyle(topic.status).nextStatus;
    setSavingTopicId(topic.id);
    setActionError(null);
    try {
      await updateCourseTopic(course.id, topic.id, { status: nextStatus });
      await loadCourse(false);
    } catch (err: unknown) {
      setActionError(
        err instanceof Error ? err.message : 'Could not update topic status.'
      );
    } finally {
      setSavingTopicId(null);
    }
  };

  const handleReorderTopic = async (topicId: string, targetPosition: number) => {
    if (!course) return;
    const current = course.topics.find((t) => t.id === topicId);
    if (!current || current.position === targetPosition) return;
    const clampedPos = Math.max(
      1,
      Math.min(targetPosition, course.topics.length)
    );

    // Optimistically reorder in UI before backend confirmation
    const reordered = course.topics.filter((t) => t.id !== topicId);
    reordered.splice(clampedPos - 1, 0, current);
    const optimisticTopics = reordered.map((t, idx) => ({
      ...t,
      position: idx + 1,
    }));
    setCourse({ ...course, topics: optimisticTopics });
    setActionError(null);

    try {
      await updateCourseTopic(course.id, topicId, { position: clampedPos });
      await loadCourse(false);
    } catch (err: unknown) {
      setActionError(
        err instanceof Error ? err.message : 'Could not reorder topic.'
      );
      await loadCourse(false);
    }
  };

  const handleConfirmDeleteTopic = async () => {
    if (!course || !confirmDeleteTopic) return;
    const target = confirmDeleteTopic;
    setConfirmDeleteTopic(null);
    setSavingTopicId(target.id);
    setActionError(null);
    try {
      await deleteCourseTopic(course.id, target.id);
      await loadCourse(false);
    } catch (err: unknown) {
      setActionError(
        err instanceof Error ? err.message : 'Could not delete topic.'
      );
    } finally {
      setSavingTopicId(null);
    }
  };

  const handleToggleLessonTaught = async (lesson: CourseLesson) => {
    if (!course || togglingLessonId) return;
    const nextStatus = lesson.status === 'taught' ? 'planned' : 'taught';
    setTogglingLessonId(lesson.id);
    setActionError(null);
    try {
      await updateCourseLessonStatus(course.id, lesson.id, nextStatus);
      await loadCourse(false);
    } catch (err: unknown) {
      setActionError(
        err instanceof Error ? err.message : 'Could not update class status.'
      );
    } finally {
      setTogglingLessonId(null);
    }
  };

  const handleConfirmDeleteLesson = async () => {
    if (!course || !confirmDeleteLesson) return;
    const target = confirmDeleteLesson;
    setConfirmDeleteLesson(null);
    setTogglingLessonId(target.id);
    setActionError(null);
    try {
      await deleteCourseLesson(course.id, target.id);
      await loadCourse(false);
    } catch (err: unknown) {
      setActionError(
        err instanceof Error ? err.message : 'Could not delete class.'
      );
    } finally {
      setTogglingLessonId(null);
    }
  };

  const handleOpenLesson = (lesson: CourseLesson) => {
    if (!course) return;
    lessonStore.syncCourseLessonWorkspace(course, lesson);
    navigate(`/lesson/${lesson.id}?courseId=${encodeURIComponent(course.id)}`, {
      state: { openStudio: true },
    });
  };

  const handleLessonCreated = (result: CreateCourseLessonResult) => {
    if (!course) return;
    setPlanModalOpen(false);
    lessonStore.syncCourseLessonWorkspace(course, result);
    // Refresh cache in background and navigate straight to the newly generated plan
    loadCourse(false);
    navigate(
      `/lesson/${result.id}?courseId=${encodeURIComponent(course.id)}`,
      { state: { openStudio: true } }
    );
  };

  const totalEstMinutes =
    course?.topics.reduce((sum, t) => sum + t.est_minutes, 0) ?? 0;

  return (
    <div className="min-h-screen bg-canvas text-ink antialiased flex flex-col">
      {/* Top Bar */}
      <header className="w-full border-b border-border/70 bg-canvas/95 sticky top-0 z-30">
        <div className="max-w-[1440px] mx-auto h-16 px-4 sm:px-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
            <Link
              to="/"
              aria-label="Lessonwright Home"
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

            <span className="text-ink-subtle text-[15px] hidden sm:inline">/</span>

            <Link
              to="/"
              className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[13px] font-medium text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <span className="material-symbols-outlined text-[16px]">home</span>
              <span>Home</span>
            </Link>

            <span className="text-ink-subtle text-[15px]">/</span>

            <h1 className="text-[14px] sm:text-[15px] font-semibold text-ink truncate">
              {course?.title || 'Course'}
            </h1>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {course && (
              <button
                type="button"
                onClick={() => setPlanModalOpen(true)}
                className="px-4 py-1.5 rounded-full bg-accent hover:bg-accent-hover text-white text-[13px] sm:text-[14px] font-medium transition-colors inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
              >
                <span className="material-symbols-outlined text-[18px]">
                  add
                </span>
                <span>Plan next class</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full max-w-[1440px] mx-auto px-4 sm:px-6 pt-6 pb-20">
        {/* Loading state */}
        {loading && !course ? (
          <div
            role="status"
            aria-label="Loading course"
            className="grid grid-cols-1 lg:grid-cols-12 gap-6"
          >
            <div className="lg:col-span-7 rounded-[20px] bg-surface border border-border p-6 space-y-3">
              <div className="h-5 w-36 rounded bg-surface-muted animate-pulse" />
              {[1, 2, 3, 4, 5].map((n) => (
                <div
                  key={n}
                  className="h-14 rounded-xl bg-surface-muted animate-pulse"
                />
              ))}
            </div>
            <div className="lg:col-span-5 space-y-6">
              <div className="h-40 rounded-[20px] bg-surface border border-border p-6 animate-pulse" />
              <div className="h-64 rounded-[20px] bg-surface border border-border p-6 animate-pulse" />
            </div>
          </div>
        ) : error && !course ? (
          /* Full-page error state */
          <div
            role="alert"
            className="max-w-lg mx-auto mt-10 rounded-[24px] bg-surface border border-border p-8 text-center space-y-3"
          >
            <span className="material-symbols-outlined text-[28px] text-danger">
              error
            </span>
            <h2 className="text-[16px] font-semibold text-ink">
              Could not load course
            </h2>
            <p className="text-[13px] text-ink-muted">{error}</p>
            <div className="flex items-center justify-center gap-2 pt-2">
              <Link
                to="/"
                className="px-4 py-1.5 rounded-full border border-border text-[13px] font-medium text-ink hover:bg-surface-muted"
              >
                Back to Home
              </Link>
              <button
                type="button"
                onClick={() => loadCourse(true)}
                className="px-4 py-1.5 rounded-full bg-accent hover:bg-accent-hover text-white text-[13px] font-medium"
              >
                Retry
              </button>
            </div>
          </div>
        ) : course ? (
          <div className="space-y-4">
            {/* Non-blocking error banner (e.g. offline cache or mutation failure) */}
            {(error || actionError) && (
              <div
                role="alert"
                className="px-4 py-2.5 rounded-xl bg-danger-soft border border-danger-border flex items-center justify-between gap-3 text-[13px] text-danger"
              >
                <span>{actionError || error}</span>
                <button
                  type="button"
                  onClick={() => {
                    setActionError(null);
                    if (error) loadCourse(false);
                  }}
                  className="text-[12px] font-medium underline flex-shrink-0"
                >
                  {error ? 'Retry' : 'Dismiss'}
                </button>
              </div>
            )}

            {/* Two-column layout: Left = Syllabus Checklist, Right = Progress + Lesson Timeline */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* LEFT COLUMN: SYLLABUS CHECKLIST */}
              <section
                aria-labelledby="syllabus-heading"
                className="lg:col-span-7 rounded-[20px] bg-surface border border-border p-5 sm:p-6 space-y-4"
              >
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <h2
                      id="syllabus-heading"
                      className="text-[16px] font-semibold text-ink tracking-tight"
                    >
                      Syllabus checklist
                    </h2>
                    <p className="text-[12px] text-ink-muted mt-0.5">
                      {course.topics.length}{' '}
                      {course.topics.length === 1 ? 'topic' : 'topics'} · ~
                      {totalEstMinutes} min total · Drag or use arrows to reorder
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleOpenAddTopic}
                    aria-label="Add topic to syllabus"
                    className="px-3 py-1.5 rounded-full bg-surface border border-border hover:border-accent hover:text-accent text-[12px] font-medium text-ink inline-flex items-center gap-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <span className="material-symbols-outlined text-[16px]">
                      add
                    </span>
                    <span>Add topic</span>
                  </button>
                </div>

                {/* Inline Add Topic Form */}
                {addingTopic && (
                  <form
                    onSubmit={handleSubmitNewTopic}
                    className="p-4 rounded-xl bg-surface-muted border border-border space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-semibold text-ink">
                        New syllabus topic
                      </span>
                      <button
                        type="button"
                        aria-label="Cancel adding topic"
                        onClick={() => setAddingTopic(false)}
                        className="text-ink-muted hover:text-ink"
                      >
                        <span className="material-symbols-outlined text-[16px]">
                          close
                        </span>
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div className="sm:col-span-2">
                        <label
                          htmlFor="add-topic-title"
                          className="block text-[11px] font-medium text-ink-muted mb-1"
                        >
                          Title
                        </label>
                        <input
                          id="add-topic-title"
                          type="text"
                          required
                          minLength={2}
                          value={newTopicTitle}
                          onChange={(e) => setNewTopicTitle(e.target.value)}
                          placeholder="e.g. Prompt Chaining Patterns"
                          className="w-full px-3 py-1.5 rounded-lg bg-surface border border-border focus:border-accent text-[13px] text-ink focus:outline-none"
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label
                          htmlFor="add-topic-summary"
                          className="block text-[11px] font-medium text-ink-muted mb-1"
                        >
                          One-sentence summary (optional)
                        </label>
                        <input
                          id="add-topic-summary"
                          type="text"
                          value={newTopicSummary}
                          onChange={(e) => setNewTopicSummary(e.target.value)}
                          placeholder="Brief summary of what this topic teaches"
                          className="w-full px-3 py-1.5 rounded-lg bg-surface border border-border focus:border-accent text-[13px] text-ink focus:outline-none"
                        />
                      </div>

                      <div className="grid grid-cols-3 gap-2 sm:col-span-2">
                        <div>
                          <label
                            htmlFor="add-topic-pstart"
                            className="block text-[11px] font-medium text-ink-muted mb-1"
                          >
                            Page start
                          </label>
                          <input
                            id="add-topic-pstart"
                            type="number"
                            min={1}
                            value={newTopicPageStart}
                            onChange={(e) => {
                              const val = Math.max(1, Number(e.target.value) || 1);
                              setNewTopicPageStart(val);
                              if (newTopicPageEnd < val) setNewTopicPageEnd(val);
                            }}
                            className="w-full px-2.5 py-1.5 rounded-lg bg-surface border border-border focus:border-accent text-[13px] text-ink focus:outline-none"
                          />
                        </div>
                        <div>
                          <label
                            htmlFor="add-topic-pend"
                            className="block text-[11px] font-medium text-ink-muted mb-1"
                          >
                            Page end
                          </label>
                          <input
                            id="add-topic-pend"
                            type="number"
                            min={newTopicPageStart}
                            value={newTopicPageEnd}
                            onChange={(e) =>
                              setNewTopicPageEnd(
                                Math.max(
                                  newTopicPageStart,
                                  Number(e.target.value) || newTopicPageStart
                                )
                              )
                            }
                            className="w-full px-2.5 py-1.5 rounded-lg bg-surface border border-border focus:border-accent text-[13px] text-ink focus:outline-none"
                          />
                        </div>
                        <div>
                          <label
                            htmlFor="add-topic-min"
                            className="block text-[11px] font-medium text-ink-muted mb-1"
                          >
                            Est. min
                          </label>
                          <input
                            id="add-topic-min"
                            type="number"
                            min={5}
                            max={120}
                            value={newTopicMinutes}
                            onChange={(e) =>
                              setNewTopicMinutes(
                                Math.max(5, Math.min(120, Number(e.target.value) || 15))
                              )
                            }
                            className="w-full px-2.5 py-1.5 rounded-lg bg-surface border border-border focus:border-accent text-[13px] text-ink focus:outline-none"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setAddingTopic(false)}
                        className="px-3 py-1 rounded-full border border-border text-[12px] font-medium text-ink-muted hover:text-ink"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={submittingNewTopic || newTopicTitle.trim().length < 2}
                        className="px-3.5 py-1 rounded-full bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-[12px] font-medium"
                      >
                        {submittingNewTopic ? 'Adding…' : 'Add topic'}
                      </button>
                    </div>
                  </form>
                )}

                {/* Topic list or empty state */}
                {course.topics.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border bg-surface-muted/50 p-8 text-center">
                    <span className="material-symbols-outlined text-[24px] text-ink-muted mb-1.5">
                      checklist
                    </span>
                    <p className="text-[14px] font-medium text-ink">
                      No topics in this syllabus yet
                    </p>
                    <p className="text-[12px] text-ink-muted mt-0.5">
                      Add a topic manually to start planning classes.
                    </p>
                    <button
                      type="button"
                      onClick={handleOpenAddTopic}
                      className="mt-3 px-3.5 py-1.5 rounded-full bg-accent hover:bg-accent-hover text-white text-[12px] font-medium"
                    >
                      Add topic
                    </button>
                  </div>
                ) : (
                  <ol className="space-y-2" aria-label="Course syllabus topics">
                    {course.topics.map((topic, index) => {
                      const chip = statusChipStyle(topic.status);
                      const isEditing = editingTopicId === topic.id;
                      const isBusy = savingTopicId === topic.id;
                      const isDropTarget =
                        dragOverTopicId === topic.id &&
                        draggingTopicId !== topic.id;

                      return (
                        <li
                          key={topic.id}
                          draggable={!isEditing}
                          onDragStart={(e) => {
                            setDraggingTopicId(topic.id);
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('text/plain', topic.id);
                          }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            if (draggingTopicId && draggingTopicId !== topic.id) {
                              setDragOverTopicId(topic.id);
                            }
                          }}
                          onDragLeave={() => {
                            if (dragOverTopicId === topic.id) {
                              setDragOverTopicId(null);
                            }
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            const sourceId =
                              draggingTopicId ||
                              e.dataTransfer.getData('text/plain');
                            setDraggingTopicId(null);
                            setDragOverTopicId(null);
                            if (sourceId && sourceId !== topic.id) {
                              handleReorderTopic(sourceId, topic.position);
                            }
                          }}
                          onDragEnd={() => {
                            setDraggingTopicId(null);
                            setDragOverTopicId(null);
                          }}
                          className={`rounded-xl border p-3 sm:p-3.5 transition-colors ${
                            isDropTarget
                              ? 'border-accent bg-accent-soft/40'
                              : draggingTopicId === topic.id
                                ? 'border-border bg-surface-muted opacity-60'
                                : 'border-border bg-surface hover:border-border-strong'
                          }`}
                        >
                          {isEditing ? (
                            /* Inline edit row (rename & change est. minutes) */
                            <form
                              onSubmit={(e) => {
                                e.preventDefault();
                                handleSaveTopicEdit(topic);
                              }}
                              className="space-y-2.5"
                            >
                              <div className="flex flex-col sm:flex-row gap-2">
                                <input
                                  type="text"
                                  value={editTitle}
                                  onChange={(e) => setEditTitle(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Escape')
                                      setEditingTopicId(null);
                                  }}
                                  aria-label="Edit topic title"
                                  autoFocus
                                  required
                                  minLength={2}
                                  className="flex-1 px-3 py-1.5 rounded-lg bg-surface-muted border border-border focus:border-accent text-[13px] text-ink focus:outline-none"
                                />
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="number"
                                    min={5}
                                    max={120}
                                    value={editMinutes}
                                    onChange={(e) =>
                                      setEditMinutes(
                                        Math.max(
                                          5,
                                          Math.min(120, Number(e.target.value) || 5)
                                        )
                                      )
                                    }
                                    aria-label="Edit estimated minutes"
                                    className="w-20 px-2.5 py-1.5 rounded-lg bg-surface-muted border border-border focus:border-accent text-[13px] text-ink focus:outline-none"
                                  />
                                  <span className="text-[12px] text-ink-muted">
                                    min
                                  </span>
                                </div>
                              </div>
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setEditingTopicId(null)}
                                  className="px-2.5 py-1 rounded-full border border-border text-[12px] text-ink-muted hover:text-ink"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="submit"
                                  disabled={isBusy || editTitle.trim().length < 2}
                                  className="px-3 py-1 rounded-full bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-[12px] font-medium"
                                >
                                  Save
                                </button>
                              </div>
                            </form>
                          ) : (
                            <div className="flex items-start gap-2.5">
                              {/* Drag handle + position */}
                              <div className="flex items-center gap-1 pt-0.5 text-ink-subtle flex-shrink-0">
                                <span
                                  aria-hidden="true"
                                  title="Drag to reorder"
                                  className="material-symbols-outlined text-[18px] cursor-grab active:cursor-grabbing hover:text-ink"
                                >
                                  drag_indicator
                                </span>
                                <span className="font-mono text-[11px] w-4 text-right text-ink-muted">
                                  {topic.position}
                                </span>
                              </div>

                              {/* Title, summary, page range, minutes */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-start justify-between gap-2 flex-wrap">
                                  <p className="text-[14px] font-medium text-ink leading-snug break-words">
                                    {topic.title}
                                  </p>
                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={() => handleCycleTopicStatus(topic)}
                                    aria-label={`Status for ${topic.title}: ${chip.label}. Click to change status.`}
                                    title="Click to cycle status"
                                    className={`px-2.5 py-0.5 rounded-full border text-[11px] font-medium transition-colors flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${chip.className}`}
                                  >
                                    {chip.label}
                                  </button>
                                </div>

                                {topic.summary && (
                                  <p className="text-[12px] text-ink-muted mt-1 leading-relaxed">
                                    {topic.summary}
                                  </p>
                                )}

                                <div className="flex items-center justify-between gap-2 mt-2 flex-wrap">
                                  <div className="flex items-center gap-2 text-[11px] font-mono text-ink-muted">
                                    <span className="px-2 py-0.5 rounded-full bg-surface-muted border border-border">
                                      {topic.page_start === topic.page_end
                                        ? `p. ${topic.page_start}`
                                        : `pp. ${topic.page_start}–${topic.page_end}`}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => startEditingTopic(topic)}
                                      aria-label={`Change estimated minutes for ${topic.title}`}
                                      className="px-2 py-0.5 rounded-full bg-surface-muted border border-border hover:border-accent hover:text-accent transition-colors"
                                    >
                                      {topic.est_minutes} min
                                    </button>
                                  </div>

                                  {/* Row actions: keyboard reorder, edit, delete */}
                                  <div className="flex items-center gap-0.5">
                                    <button
                                      type="button"
                                      disabled={index === 0 || isBusy}
                                      onClick={() =>
                                        handleReorderTopic(
                                          topic.id,
                                          topic.position - 1
                                        )
                                      }
                                      aria-label={`Move ${topic.title} up`}
                                      title="Move up"
                                      className="w-7 h-7 rounded-md flex items-center justify-center text-ink-muted hover:text-ink hover:bg-surface-muted disabled:opacity-30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                    >
                                      <span className="material-symbols-outlined text-[16px]">
                                        arrow_upward
                                      </span>
                                    </button>
                                    <button
                                      type="button"
                                      disabled={
                                        index === course.topics.length - 1 ||
                                        isBusy
                                      }
                                      onClick={() =>
                                        handleReorderTopic(
                                          topic.id,
                                          topic.position + 1
                                        )
                                      }
                                      aria-label={`Move ${topic.title} down`}
                                      title="Move down"
                                      className="w-7 h-7 rounded-md flex items-center justify-center text-ink-muted hover:text-ink hover:bg-surface-muted disabled:opacity-30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                    >
                                      <span className="material-symbols-outlined text-[16px]">
                                        arrow_downward
                                      </span>
                                    </button>
                                    <button
                                      type="button"
                                      disabled={isBusy}
                                      onClick={() => startEditingTopic(topic)}
                                      aria-label={`Rename or edit ${topic.title}`}
                                      title="Rename / edit minutes"
                                      className="w-7 h-7 rounded-md flex items-center justify-center text-ink-muted hover:text-ink hover:bg-surface-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                    >
                                      <span className="material-symbols-outlined text-[16px]">
                                        edit
                                      </span>
                                    </button>
                                    <button
                                      type="button"
                                      disabled={isBusy}
                                      onClick={() => setConfirmDeleteTopic(topic)}
                                      aria-label={`Delete topic ${topic.title}`}
                                      title="Delete topic"
                                      className="w-7 h-7 rounded-md flex items-center justify-center text-ink-muted hover:text-danger hover:bg-danger-soft transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                    >
                                      <span className="material-symbols-outlined text-[16px]">
                                        delete
                                      </span>
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </section>

              {/* RIGHT COLUMN: PROGRESS CARD + LESSON TIMELINE */}
              <div className="lg:col-span-5 space-y-6">
                {/* Progress Card */}
                <section
                  aria-labelledby="progress-heading"
                  className="rounded-[20px] bg-surface border border-border p-5 sm:p-6 space-y-4"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h2
                      id="progress-heading"
                      className="text-[16px] font-semibold text-ink tracking-tight"
                    >
                      Progress
                    </h2>
                    <span className="text-[12px] font-medium text-ink-muted">
                      {course.progress.taught} of {course.progress.topics_total}{' '}
                      topics taught
                    </span>
                  </div>

                  {/* Thin teal progress bar */}
                  <div
                    role="progressbar"
                    aria-label="Course pages covered"
                    aria-valuenow={Math.round(course.progress.percent_pages)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    className="w-full h-2 rounded-full bg-surface-muted border border-border overflow-hidden"
                  >
                    <div
                      style={{
                        width: `${Math.min(100, Math.max(0, course.progress.percent_pages))}%`,
                      }}
                      className="h-full bg-accent transition-all duration-300"
                    />
                  </div>

                  {/* "42% of pages covered, next: <topic>" */}
                  <p className="text-[13px] text-ink leading-relaxed">
                    <span className="font-semibold text-accent">
                      {Math.round(course.progress.percent_pages)}% of pages
                      covered
                    </span>
                    {course.progress.next_topics.length > 0 ? (
                      <>
                        ,{' '}
                        <span className="text-ink-muted">next:</span>{' '}
                        <span className="font-medium text-ink">
                          {course.progress.next_topics[0].title}
                        </span>
                      </>
                    ) : (
                      <span className="text-ink-muted">
                        {' '}
                        — all topics planned or taught
                      </span>
                    )}
                  </p>

                  {/* Breakdown chips */}
                  <div className="flex items-center gap-2 flex-wrap text-[12px]">
                    <span className="px-2.5 py-0.5 rounded-full bg-accent-soft text-accent border border-accent/25 font-medium">
                      {course.progress.taught} taught
                    </span>
                    <span className="px-2.5 py-0.5 rounded-full bg-surface-muted text-ink border border-border font-medium">
                      {course.progress.planned} planned
                    </span>
                    <span className="px-2.5 py-0.5 rounded-full bg-surface-chip text-ink-muted border border-border">
                      {Math.max(
                        0,
                        course.progress.topics_total -
                          course.progress.taught -
                          course.progress.planned
                      )}{' '}
                      not started
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => setPlanModalOpen(true)}
                    className="w-full py-2 px-4 rounded-full bg-accent hover:bg-accent-hover text-white text-[13px] font-medium transition-colors inline-flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                  >
                    <span className="material-symbols-outlined text-[18px]">
                      event_upcoming
                    </span>
                    <span>Plan next class</span>
                  </button>
                </section>

                {/* Lesson Timeline ("Class 1, Class 2, ...") */}
                <section
                  aria-labelledby="timeline-heading"
                  className="rounded-[20px] bg-surface border border-border p-5 sm:p-6 space-y-4"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h2
                      id="timeline-heading"
                      className="text-[16px] font-semibold text-ink tracking-tight"
                    >
                      Lesson timeline
                    </h2>
                    <span className="text-[12px] text-ink-muted">
                      {course.lessons.length}{' '}
                      {course.lessons.length === 1 ? 'class' : 'classes'}
                    </span>
                  </div>

                  {course.lessons.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border bg-surface-muted/50 p-7 text-center">
                      <span className="material-symbols-outlined text-[24px] text-ink-muted mb-1.5">
                        calendar_today
                      </span>
                      <p className="text-[14px] font-medium text-ink">
                        No classes planned yet
                      </p>
                      <p className="text-[12px] text-ink-muted mt-0.5 max-w-xs mx-auto">
                        Click "Plan next class" to generate Class 1 grounded in
                        your syllabus pages.
                      </p>
                    </div>
                  ) : (
                    <div className="relative pl-4 border-l border-border space-y-4">
                      {course.lessons.map((lesson) => {
                        const isTaught = lesson.status === 'taught';
                        const isBusy = togglingLessonId === lesson.id;
                        const coveredNames =
                          lesson.plan?.covered_topics &&
                          lesson.plan.covered_topics.length > 0
                            ? lesson.plan.covered_topics
                            : lesson.topic_ids
                                .map(
                                  (tid) =>
                                    course.topics.find((t) => t.id === tid)
                                      ?.title
                                )
                                .filter((v): v is string => Boolean(v));

                        return (
                          <article
                            key={lesson.id}
                            className="relative rounded-xl border border-border bg-surface p-4 space-y-3 hover:border-border-strong transition-colors"
                          >
                            {/* Timeline node */}
                            <span
                              className={`absolute -left-[21px] top-4 w-2.5 h-2.5 rounded-full border-2 ${
                                isTaught
                                  ? 'bg-accent border-accent'
                                  : 'bg-surface border-accent'
                              }`}
                            />

                            {/* Top meta row */}
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-[11px] font-semibold uppercase tracking-wider text-accent">
                                    Class {lesson.seq}
                                  </span>
                                  <span className="text-[11px] text-ink-muted">
                                    {formatDate(lesson.created_at)} ·{' '}
                                    {lesson.duration_min} min
                                  </span>
                                </div>
                                <h3 className="text-[14px] font-semibold text-ink mt-0.5 leading-snug break-words">
                                  {lesson.title}
                                </h3>
                              </div>

                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => setConfirmDeleteLesson(lesson)}
                                aria-label={`Delete Class ${lesson.seq}`}
                                title="Delete class"
                                className="w-7 h-7 rounded-md flex items-center justify-center text-ink-muted hover:text-danger hover:bg-danger-soft transition-colors flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                              >
                                <span className="material-symbols-outlined text-[16px]">
                                  delete
                                </span>
                              </button>
                            </div>

                            {/* Topics covered chips */}
                            {coveredNames.length > 0 && (
                              <div className="flex items-center flex-wrap gap-1.5">
                                {coveredNames.map((name, i) => (
                                  <span
                                    key={`${name}-${i}`}
                                    className="px-2 py-0.5 rounded-full bg-surface-muted border border-border text-[11px] text-ink-muted"
                                  >
                                    {name}
                                  </span>
                                ))}
                              </div>
                            )}

                            {/* Footer controls: Mark as taught toggle + Open button */}
                            <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/80 flex-wrap">
                              <button
                                type="button"
                                role="switch"
                                aria-checked={isTaught}
                                aria-label={`Mark Class ${lesson.seq} as taught`}
                                disabled={isBusy}
                                onClick={() => handleToggleLessonTaught(lesson)}
                                className="inline-flex items-center gap-2 text-[12px] font-medium text-ink disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-full py-0.5 pr-1"
                              >
                                <span
                                  className={`relative inline-flex h-5 w-9 items-center rounded-full border transition-colors ${
                                    isTaught
                                      ? 'bg-accent border-accent'
                                      : 'bg-surface-muted border-border-strong/70'
                                  }`}
                                >
                                  <span
                                    className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                                      isTaught
                                        ? 'translate-x-4'
                                        : 'translate-x-0.5'
                                    }`}
                                  />
                                </span>
                                <span
                                  className={
                                    isTaught ? 'text-accent' : 'text-ink-muted'
                                  }
                                >
                                  {isTaught ? 'Taught' : 'Mark as taught'}
                                </span>
                              </button>

                              <button
                                type="button"
                                onClick={() => handleOpenLesson(lesson)}
                                aria-label={`Open Class ${lesson.seq} lesson plan`}
                                className="px-3 py-1 rounded-full bg-surface border border-border hover:border-accent hover:text-accent text-[12px] font-medium text-ink inline-flex items-center gap-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                              >
                                <span>Open</span>
                                <span className="material-symbols-outlined text-[14px]">
                                  arrow_forward
                                </span>
                              </button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </section>
              </div>
            </div>
          </div>
        ) : null}
      </main>

      {/* Plan Next Class Modal */}
      {course && (
        <PlanNextClassModal
          open={planModalOpen}
          course={course}
          onClose={() => setPlanModalOpen(false)}
          onCreated={handleLessonCreated}
        />
      )}

      {/* Delete Topic Confirmation Modal */}
      {confirmDeleteTopic && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-topic-heading"
          className="fixed inset-0 z-50 bg-ink/20 flex items-center justify-center p-4"
          onClick={() => setConfirmDeleteTopic(null)}
        >
          <div
            className="w-full max-w-md rounded-[20px] bg-surface border border-border p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              id="delete-topic-heading"
              className="text-[15px] font-semibold text-ink"
            >
              Delete topic?
            </h3>
            <p className="text-[13px] text-ink-muted leading-relaxed">
              Remove{' '}
              <span className="font-medium text-ink">
                "{confirmDeleteTopic.title}"
              </span>{' '}
              from the syllabus? Remaining topics will be renumbered.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteTopic(null)}
                className="px-3.5 py-1.5 rounded-full border border-border text-[13px] font-medium text-ink-muted hover:text-ink"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteTopic}
                className="px-4 py-1.5 rounded-full bg-danger text-white text-[13px] font-medium hover:opacity-90"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Lesson Confirmation Modal */}
      {confirmDeleteLesson && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-class-heading"
          className="fixed inset-0 z-50 bg-ink/20 flex items-center justify-center p-4"
          onClick={() => setConfirmDeleteLesson(null)}
        >
          <div
            className="w-full max-w-md rounded-[20px] bg-surface border border-border p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              id="delete-class-heading"
              className="text-[15px] font-semibold text-ink"
            >
              Delete Class {confirmDeleteLesson.seq}?
            </h3>
            <p className="text-[13px] text-ink-muted leading-relaxed">
              Deleting{' '}
              <span className="font-medium text-ink">
                "{confirmDeleteLesson.title}"
              </span>{' '}
              will revert its topics to "Not started" if no other class covers
              them.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteLesson(null)}
                className="px-3.5 py-1.5 rounded-full border border-border text-[13px] font-medium text-ink-muted hover:text-ink"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteLesson}
                className="px-4 py-1.5 rounded-full bg-danger text-white text-[13px] font-medium hover:opacity-90"
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

