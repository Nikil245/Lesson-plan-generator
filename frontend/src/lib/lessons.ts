import {
  ChatSettings,
  CourseDetail,
  CourseLesson,
  CourseSummary,
  createSessionId,
  LessonPlan,
} from '../api/client';
import { ChatMessage } from '../components/ChatPanel';

/**
 * Standalone lesson workspace sessions are persisted in `localStorage` under
 * `"lessonwright.lessons"`. For courses, the backend SQLite database
 * (`/courses`, `/courses/{id}`, `/courses/{id}/lessons`) is the source of truth
 * and `localStorage` is used strictly as a fast client-side cache.
 */

export const LESSONS_STORAGE_KEY = 'lessonwright.lessons';
export const COURSES_CACHE_KEY = 'lessonwright.courses.cache';
const COURSE_DETAIL_CACHE_PREFIX = 'lessonwright.course.cache.';

export interface LessonSettings {
  level: string;
  duration_min: number;
  audience: string;
  objectives?: string[];
  source_ids?: string[] | null;
}

export interface LessonRecord {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  sourceCount: number;
  settings: LessonSettings;
  messages: ChatMessage[];
  plan: LessonPlan | null;
  /** ID of the currently active/selected plan version in Studio */
  activePlanId?: string | null;
  /** Optional starter message pre-filled in the composer when created from a template */
  initialPrompt?: string;
  /** Tracks whether the user manually renamed the lesson so plan updates don't overwrite it */
  titleManuallyEdited?: boolean;
  /** Optional link to a backend-tracked course and its generated lesson */
  courseId?: string;
  courseTitle?: string;
  courseLessonId?: string;
  courseLessonSeq?: number;
}

export const DEFAULT_LESSON_SETTINGS: ChatSettings = {
  level: 'beginner',
  duration_min: 60,
  audience: 'All',
  objectives: [],
  source_ids: null,
};

function readAllRecords(): LessonRecord[] {
  try {
    const raw = window.localStorage.getItem(LESSONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is LessonRecord =>
        item && typeof item === 'object' && typeof item.id === 'string'
    );
  } catch {
    return [];
  }
}

function writeAllRecords(records: LessonRecord[]): void {
  try {
    window.localStorage.setItem(LESSONS_STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Ignore storage quota or security errors
  }
}

/**
 * List all saved lessons sorted by updatedAt descending (most recent first).
 */
export function list(): LessonRecord[] {
  const records = readAllRecords();
  return [...records].sort(
    (a, b) =>
      new Date(b.updatedAt || b.createdAt).getTime() -
      new Date(a.updatedAt || a.createdAt).getTime()
  );
}

/**
 * Get a single lesson record by id, or null if not found.
 */
export function get(id: string): LessonRecord | null {
  const records = readAllRecords();
  return records.find((r) => r.id === id) ?? null;
}

/**
 * Create an empty lesson record with optional overrides and save it immediately.
 */
export function createEmptyLesson(
  overrides?: Partial<
    Pick<
      LessonRecord,
      'id' | 'title' | 'sourceCount' | 'settings' | 'initialPrompt'
    >
  >
): LessonRecord {
  const now = new Date().toISOString();
  const record: LessonRecord = {
    id: overrides?.id || createSessionId(),
    title: overrides?.title || 'Untitled lesson',
    createdAt: now,
    updatedAt: now,
    sourceCount: overrides?.sourceCount ?? 0,
    settings: {
      level: overrides?.settings?.level || DEFAULT_LESSON_SETTINGS.level,
      duration_min:
        overrides?.settings?.duration_min ??
        DEFAULT_LESSON_SETTINGS.duration_min,
      audience:
        overrides?.settings?.audience || DEFAULT_LESSON_SETTINGS.audience,
      objectives: overrides?.settings?.objectives ?? [],
      source_ids: overrides?.settings?.source_ids ?? null,
    },
    messages: [],
    plan: null,
    activePlanId: null,
    initialPrompt: overrides?.initialPrompt,
    titleManuallyEdited: false,
  };
  save(record);
  return record;
}

/**
 * Save (insert or update) a lesson record.
 */
export function save(record: LessonRecord): LessonRecord {
  const records = readAllRecords();
  const idx = records.findIndex((r) => r.id === record.id);
  const resolvedTitle =
    !record.titleManuallyEdited && record.plan?.title
      ? record.plan.title
      : record.title || 'Untitled lesson';

  const normalized: LessonRecord = {
    ...record,
    title: resolvedTitle,
    createdAt:
      record.createdAt ||
      (idx >= 0 ? records[idx].createdAt : new Date().toISOString()),
    updatedAt: record.updatedAt || new Date().toISOString(),
  };

  if (idx >= 0) {
    records[idx] = normalized;
  } else {
    records.unshift(normalized);
  }
  writeAllRecords(records);
  return normalized;
}

/**
 * Rename an existing lesson by id.
 */
export function rename(id: string, newTitle: string): LessonRecord | null {
  const records = readAllRecords();
  const idx = records.findIndex((r) => r.id === id);
  if (idx === -1) return null;

  const trimmed = newTitle.trim() || 'Untitled lesson';
  const updated: LessonRecord = {
    ...records[idx],
    title: trimmed,
    titleManuallyEdited: true,
    updatedAt: new Date().toISOString(),
  };
  records[idx] = updated;
  writeAllRecords(records);
  return updated;
}

/**
 * Duplicate an existing lesson with a new UUID and "(Copy)" suffix.
 */
export function duplicate(id: string): LessonRecord | null {
  const original = get(id);
  if (!original) return null;

  const now = new Date().toISOString();
  const copy: LessonRecord = {
    ...original,
    id: createSessionId(),
    title: `${original.title || 'Untitled lesson'} (Copy)`,
    createdAt: now,
    updatedAt: now,
    settings: {
      ...original.settings,
      objectives: [...(original.settings.objectives || [])],
      source_ids: original.settings.source_ids
        ? [...original.settings.source_ids]
        : null,
    },
    messages: original.messages.map((m) => ({
      ...m,
      isStreaming: false,
      currentStatus: null,
    })),
    plan: original.plan ? JSON.parse(JSON.stringify(original.plan)) : null,
    activePlanId: original.activePlanId ?? null,
    titleManuallyEdited: true,
  };

  return save(copy);
}

/**
 * Delete a lesson by id.
 */
function deleteLesson(id: string): boolean {
  const records = readAllRecords();
  const next = records.filter((r) => r.id !== id);
  if (next.length === records.length) return false;
  writeAllRecords(next);
  return true;
}

export { deleteLesson as delete, deleteLesson as remove };

// ---------------------------------------------------------------------------
// Course cache helpers (backend is source of truth; localStorage is cache only)
// ---------------------------------------------------------------------------

export function readCachedCourses(): CourseSummary[] {
  try {
    const raw = window.localStorage.getItem(COURSES_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CourseSummary[]) : [];
  } catch {
    return [];
  }
}

export function writeCachedCourses(courses: CourseSummary[]): void {
  try {
    window.localStorage.setItem(COURSES_CACHE_KEY, JSON.stringify(courses));
  } catch {
    // Ignore storage quota or security errors
  }
}

export function readCachedCourseDetail(courseId: string): CourseDetail | null {
  try {
    const raw = window.localStorage.getItem(
      `${COURSE_DETAIL_CACHE_PREFIX}${courseId}`
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.id === 'string'
      ? (parsed as CourseDetail)
      : null;
  } catch {
    return null;
  }
}

export function writeCachedCourseDetail(course: CourseDetail): void {
  try {
    window.localStorage.setItem(
      `${COURSE_DETAIL_CACHE_PREFIX}${course.id}`,
      JSON.stringify(course)
    );
    // Keep the summary list cache in sync when a single course is updated
    const listCache = readCachedCourses();
    const summary: CourseSummary = {
      id: course.id,
      title: course.title,
      source_ids: course.source_ids,
      created_at: course.created_at,
      progress: course.progress,
    };
    const idx = listCache.findIndex((c) => c.id === course.id);
    if (idx >= 0) {
      listCache[idx] = summary;
    } else {
      listCache.unshift(summary);
    }
    writeCachedCourses(listCache);
  } catch {
    // Ignore storage quota or security errors
  }
}

/**
 * Sync a backend course lesson into the local workspace record cache so
 * `/lesson/:id?courseId=:courseId` opens immediately with the plan & course context
 * while preserving any existing chat history for that class.
 */
export function syncCourseLessonWorkspace(
  course: Pick<CourseDetail, 'id' | 'title' | 'source_ids'>,
  lesson: CourseLesson
): LessonRecord {
  const existing = get(lesson.id);
  const now = new Date().toISOString();
  const planId = existing?.activePlanId || `course-lesson-${lesson.id}`;

  const record: LessonRecord = {
    id: lesson.id,
    title: lesson.plan?.title || lesson.title || `Class ${lesson.seq}`,
    createdAt: existing?.createdAt || lesson.created_at || now,
    updatedAt: now,
    sourceCount: course.source_ids.length,
    settings: {
      level: lesson.plan?.level || existing?.settings?.level || 'beginner',
      duration_min:
        lesson.plan?.duration_min ||
        lesson.duration_min ||
        existing?.settings?.duration_min ||
        60,
      audience:
        lesson.plan?.audience ||
        existing?.settings?.audience ||
        'university students',
      objectives: existing?.settings?.objectives ?? [],
      source_ids:
        course.source_ids.length > 0
          ? course.source_ids
          : existing?.settings?.source_ids ?? null,
    },
    messages: existing?.messages || [],
    plan: lesson.plan,
    activePlanId: planId,
    titleManuallyEdited: existing?.titleManuallyEdited ?? false,
    courseId: course.id,
    courseTitle: course.title,
    courseLessonId: lesson.id,
    courseLessonSeq: lesson.seq,
  };

  return save(record);
}

