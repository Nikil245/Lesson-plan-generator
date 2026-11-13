import { ChatSettings, createSessionId, LessonPlan } from '../api/client';
import { ChatMessage } from '../components/ChatPanel';

/**
 * NOTE: The backend currently stores chat session history only in process memory
 * (`SESSIONS` in `backend/app/chat.py`). Until a persistent backend session store
 * replaces it, this module persists lesson records (`messages`, `plan`, `settings`,
 * and metadata) in `localStorage` under `"lessonwright.lessons"` so users can browse,
 * reopen, rename, duplicate, and delete lessons from the Home library.
 */

export const LESSONS_STORAGE_KEY = 'lessonwright.lessons';

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
  /** Optional starter message pre-filled in the composer when created from a template */
  initialPrompt?: string;
  /** Tracks whether the user manually renamed the lesson so plan updates don't overwrite it */
  titleManuallyEdited?: boolean;
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

