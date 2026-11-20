/**
 * Centralized API client for Lessonwright backend (http://localhost:8000).
 * All HTTP and Server-Sent Events (SSE) calls live here.
 */

export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE ||
  import.meta.env.VITE_API_URL ||
  'http://localhost:8000'
).replace(/\/$/, '');

// ---------------------------------------------------------------------------
// Data types matching backend/app/schemas.py & backend/app/ingest.py
// ---------------------------------------------------------------------------

export interface SourceSummary {
  id: string;
  title: string;
  url: string;
  topic: string;
  filename: string;
  pages: number;
  chunk_count: number;
}

export interface SourceChunk {
  id: string;
  page: number;
  chunk_index: number;
  text: string;
}

export interface SourceDetail extends SourceSummary {
  chunks: SourceChunk[];
}

export interface IngestResult {
  source_id: string;
  title: string;
  filename: string;
  pages: number;
  chunks: number;
  warning?: string;
}

export interface SourceItem {
  id: string;
  n: number;
  title: string;
  url: string;
  page: number;
  excerpt: string;
}

export type OutlineActivityType = 'demo' | 'discuss' | 'hands-on';

export interface OutlineItem {
  start_min: number;
  end_min: number;
  title: string;
  type: OutlineActivityType;
  description: string;
  example_prompt: string | null;
}

export interface Citation {
  n: number;
  source_id: string;
  title: string;
  page: number;
  url: string;
}

export interface LessonPlan {
  title: string;
  level: string;
  audience: string;
  duration_min: number;
  objectives: string[];
  prerequisites: string[];
  outline: OutlineItem[];
  assessment: string[];
  further_reading: string[];
  covered_topics?: string[];
  not_covered_yet?: string[];
  citations: Citation[];
}

export interface ChatSettings {
  level: string;
  duration_min: number;
  audience: string;
  objectives: string[];
  source_ids: string[] | null;
  course_id?: string | null;
}

export interface ChatRequest {
  session_id: string;
  message: string;
  course_id?: string | null;
  settings: ChatSettings;
}

// ---------------------------------------------------------------------------
// Course & progress tracking types matching backend/app/db.py & schemas.py
// ---------------------------------------------------------------------------

export type TopicStatus = 'not_started' | 'planned' | 'taught';
export type LessonStatus = 'planned' | 'taught';

export interface NextTopicSummary {
  id: string;
  position: number;
  title: string;
  page_start: number;
  page_end: number;
  est_minutes: number;
}

export interface CourseProgress {
  topics_total: number;
  planned: number;
  taught: number;
  percent_topics: number;
  percent_pages: number;
  next_topics: NextTopicSummary[];
}

export interface CourseTopic {
  id: string;
  course_id: string;
  position: number;
  title: string;
  summary: string;
  page_start: number;
  page_end: number;
  est_minutes: number;
  status: TopicStatus;
}

export interface CourseLesson {
  id: string;
  course_id: string;
  seq: number;
  title: string;
  duration_min: number;
  topic_ids: string[];
  plan: LessonPlan;
  status: LessonStatus;
  created_at: string;
}

export interface CourseSummary {
  id: string;
  title: string;
  source_ids: string[];
  created_at: string;
  progress: CourseProgress;
}

export interface CourseDetail extends CourseSummary {
  topics: CourseTopic[];
  lessons: CourseLesson[];
}

export interface CreateCoursePayload {
  title: string;
  source_ids: string[];
}

export interface CreateTopicPayload {
  title: string;
  summary?: string;
  page_start: number;
  page_end: number;
  est_minutes: number;
  position?: number;
}

export interface UpdateTopicPayload {
  title?: string;
  summary?: string;
  page_start?: number;
  page_end?: number;
  position?: number;
  est_minutes?: number;
  status?: TopicStatus;
}

export interface CreateCourseLessonPayload {
  duration_min: number;
  level: string;
  audience: string;
  objectives?: string[];
  topic_ids?: string[];
}

export interface CreateCourseLessonResult extends CourseLesson {
  covered_topics: CourseTopic[];
  remaining_topics: CourseTopic[];
  progress: CourseProgress;
}

export interface UpdateCourseLessonResult extends CourseLesson {
  progress: CourseProgress;
}

export interface ChatSSEHandlers {
  onStatus?: (step: string) => void;
  onSources?: (items: SourceItem[]) => void;
  onToken?: (text: string) => void;
  onPlan?: (plan: LessonPlan) => void;
  onDone?: () => void;
  onError?: (message: string) => void;
}

// ---------------------------------------------------------------------------
// Session UUID helper
// ---------------------------------------------------------------------------

export function createSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback RFC4122 v4 UUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ---------------------------------------------------------------------------
// In-memory cache for GET /sources/{id}
// ---------------------------------------------------------------------------

const sourceDetailCache = new Map<string, SourceDetail>();

export function clearSourceDetailCache(sourceId?: string): void {
  if (sourceId) {
    sourceDetailCache.delete(sourceId);
  } else {
    sourceDetailCache.clear();
  }
}

// ---------------------------------------------------------------------------
// REST API endpoints
// ---------------------------------------------------------------------------

/**
 * GET /sources -> list every ingested document with its chunk & page counts.
 */
export async function fetchSources(): Promise<SourceSummary[]> {
  const response = await fetch(`${API_BASE_URL}/sources`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    const detail = await safeReadError(response);
    throw new Error(detail || `Failed to load sources (${response.status})`);
  }

  return response.json();
}

/**
 * GET /sources/{id} -> return one document's info and all of its chunks
 * (used by the citation popover).
 */
export async function fetchSourceDetail(
  sourceId: string,
  forceRefresh = false
): Promise<SourceDetail> {
  if (!forceRefresh && sourceDetailCache.has(sourceId)) {
    return sourceDetailCache.get(sourceId)!;
  }

  const response = await fetch(
    `${API_BASE_URL}/sources/${encodeURIComponent(sourceId)}`,
    {
      method: 'GET',
      headers: { Accept: 'application/json' },
    }
  );

  if (!response.ok) {
    const detail = await safeReadError(response);
    throw new Error(detail || `Source '${sourceId}' not found (${response.status})`);
  }

  const data: SourceDetail = await response.json();
  sourceDetailCache.set(sourceId, data);
  return data;
}

/**
 * POST /ingest -> upload a .pdf, .md, or .txt file to be chunked and indexed.
 */
export async function ingestSource(
  file: File,
  metadata?: { title?: string; url?: string; topic?: string }
): Promise<IngestResult> {
  const formData = new FormData();
  formData.append('file', file);
  if (metadata?.title?.trim()) {
    formData.append('title', metadata.title.trim());
  }
  if (metadata?.url?.trim()) {
    formData.append('url', metadata.url.trim());
  }
  if (metadata?.topic?.trim()) {
    formData.append('topic', metadata.topic.trim());
  }

  const response = await fetch(`${API_BASE_URL}/ingest`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const detail = await safeReadError(response);
    throw new Error(detail || `Upload failed (${response.status})`);
  }

  const result: IngestResult = await response.json();
  clearSourceDetailCache(result.source_id);
  return result;
}

// ---------------------------------------------------------------------------
// Course & progress tracking endpoints (/courses, /courses/{id}, ...)
// ---------------------------------------------------------------------------

/**
 * GET /courses -> list all courses with progress summaries.
 */
export async function fetchCourses(): Promise<CourseSummary[]> {
  const response = await fetch(`${API_BASE_URL}/courses`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    const detail = await safeReadError(response);
    throw new Error(detail || `Failed to load courses (${response.status})`);
  }

  return response.json();
}

/**
 * POST /courses -> create a course and generate its syllabus from source_ids.
 */
export async function createCourse(
  payload: CreateCoursePayload
): Promise<CourseDetail> {
  const response = await fetch(`${API_BASE_URL}/courses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await safeReadError(response);
    throw new Error(detail || `Failed to create course (${response.status})`);
  }

  return response.json();
}

/**
 * GET /courses/{id} -> fetch course metadata, syllabus topics, lessons, and progress.
 */
export async function fetchCourse(courseId: string): Promise<CourseDetail> {
  const response = await fetch(
    `${API_BASE_URL}/courses/${encodeURIComponent(courseId)}`,
    {
      method: 'GET',
      headers: { Accept: 'application/json' },
    }
  );

  if (!response.ok) {
    const detail = await safeReadError(response);
    throw new Error(detail || `Course '${courseId}' not found (${response.status})`);
  }

  return response.json();
}

/**
 * GET /courses/{id}/progress -> fetch topic/page progress and upcoming topics.
 */
export async function fetchCourseProgress(
  courseId: string
): Promise<CourseProgress> {
  const response = await fetch(
    `${API_BASE_URL}/courses/${encodeURIComponent(courseId)}/progress`,
    {
      method: 'GET',
      headers: { Accept: 'application/json' },
    }
  );

  if (!response.ok) {
    const detail = await safeReadError(response);
    throw new Error(detail || `Failed to load progress (${response.status})`);
  }

  return response.json();
}

/**
 * POST /courses/{id}/topics -> add a new topic to the course syllabus.
 */
export async function addCourseTopic(
  courseId: string,
  payload: CreateTopicPayload
): Promise<CourseTopic> {
  const response = await fetch(
    `${API_BASE_URL}/courses/${encodeURIComponent(courseId)}/topics`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    const detail = await safeReadError(response);
    throw new Error(detail || `Failed to add topic (${response.status})`);
  }

  return response.json();
}

/**
 * PATCH /courses/{id}/topics/{topic_id} -> edit a topic's title, minutes, position, or status.
 */
export async function updateCourseTopic(
  courseId: string,
  topicId: string,
  payload: UpdateTopicPayload
): Promise<CourseTopic> {
  const response = await fetch(
    `${API_BASE_URL}/courses/${encodeURIComponent(courseId)}/topics/${encodeURIComponent(topicId)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    const detail = await safeReadError(response);
    throw new Error(detail || `Failed to update topic (${response.status})`);
  }

  return response.json();
}

/**
 * DELETE /courses/{id}/topics/{topic_id} -> remove a topic from the course syllabus.
 */
export async function deleteCourseTopic(
  courseId: string,
  topicId: string
): Promise<{ deleted: boolean; topic_id: string }> {
  const response = await fetch(
    `${API_BASE_URL}/courses/${encodeURIComponent(courseId)}/topics/${encodeURIComponent(topicId)}`,
    {
      method: 'DELETE',
      headers: { Accept: 'application/json' },
    }
  );

  if (!response.ok) {
    const detail = await safeReadError(response);
    throw new Error(detail || `Failed to delete topic (${response.status})`);
  }

  return response.json();
}

/**
 * POST /courses/{id}/lessons -> generate and save the next class lesson plan.
 */
export async function createCourseLesson(
  courseId: string,
  payload: CreateCourseLessonPayload
): Promise<CreateCourseLessonResult> {
  const response = await fetch(
    `${API_BASE_URL}/courses/${encodeURIComponent(courseId)}/lessons`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    const detail = await safeReadError(response);
    throw new Error(detail || `Failed to generate class plan (${response.status})`);
  }

  return response.json();
}

/**
 * PATCH /courses/{id}/lessons/{lesson_id} -> toggle lesson status ('planned' | 'taught').
 */
export async function updateCourseLessonStatus(
  courseId: string,
  lessonId: string,
  status: LessonStatus
): Promise<UpdateCourseLessonResult> {
  const response = await fetch(
    `${API_BASE_URL}/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ status }),
    }
  );

  if (!response.ok) {
    const detail = await safeReadError(response);
    throw new Error(detail || `Failed to update class status (${response.status})`);
  }

  return response.json();
}

/**
 * DELETE /courses/{id}/lessons/{lesson_id} -> delete a planned lesson and revert unused topics.
 */
export async function deleteCourseLesson(
  courseId: string,
  lessonId: string
): Promise<{ deleted: boolean; lesson_id: string; progress: CourseProgress }> {
  const response = await fetch(
    `${API_BASE_URL}/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}`,
    {
      method: 'DELETE',
      headers: { Accept: 'application/json' },
    }
  );

  if (!response.ok) {
    const detail = await safeReadError(response);
    throw new Error(detail || `Failed to delete class (${response.status})`);
  }

  return response.json();
}

// ---------------------------------------------------------------------------
// POST /chat -> Server-Sent Events via fetch + ReadableStream reader
// ---------------------------------------------------------------------------

/**
 * Stream a chat turn using fetch and a ReadableStream reader (NOT EventSource).
 * Parses SSE frames:
 *   status  -> { step: string }
 *   sources -> { items: SourceItem[] }
 *   token   -> { text: string }
 *   plan    -> { data: LessonPlan }
 *   done    -> {}
 *   error   -> { message: string }
 */
export async function streamChat(
  request: ChatRequest,
  handlers: ChatSSEHandlers,
  signal?: AbortSignal
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok) {
    const detail = await safeReadError(response);
    throw new Error(detail || `Chat request failed (${response.status})`);
  }

  if (!response.body) {
    throw new Error('ReadableStream is not supported in this browser.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let doneCalled = false;

  const dispatchFrame = (rawFrame: string) => {
    const lines = rawFrame.split('\n');
    let eventName = 'message';
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventName = line.slice('event:'.length).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice('data:'.length).trim());
      }
    }

    if (dataLines.length === 0) {
      return;
    }

    const rawData = dataLines.join('\n');
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(rawData);
    } catch {
      return;
    }

    switch (eventName) {
      case 'status': {
        if (typeof parsed.step === 'string') {
          handlers.onStatus?.(parsed.step);
        }
        break;
      }
      case 'sources': {
        if (Array.isArray(parsed.items)) {
          handlers.onSources?.(parsed.items as SourceItem[]);
        }
        break;
      }
      case 'token': {
        if (typeof parsed.text === 'string') {
          handlers.onToken?.(parsed.text);
        }
        break;
      }
      case 'plan': {
        if (parsed.data && typeof parsed.data === 'object') {
          handlers.onPlan?.(parsed.data as LessonPlan);
        }
        break;
      }
      case 'error': {
        const msg =
          typeof parsed.message === 'string'
            ? parsed.message
            : 'An unexpected error occurred while generating the response.';
        handlers.onError?.(msg);
        break;
      }
      case 'done': {
        if (!doneCalled) {
          doneCalled = true;
          handlers.onDone?.();
        }
        break;
      }
      default:
        break;
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      // Normalize CRLF -> LF before splitting on double newlines
      buffer = buffer.replace(/\r\n/g, '\n');

      let boundaryIndex = buffer.indexOf('\n\n');
      while (boundaryIndex !== -1) {
        const rawFrame = buffer.slice(0, boundaryIndex).trim();
        buffer = buffer.slice(boundaryIndex + 2);
        if (rawFrame) {
          dispatchFrame(rawFrame);
        }
        boundaryIndex = buffer.indexOf('\n\n');
      }
    }

    // Flush any remaining frame
    const trailing = buffer.trim();
    if (trailing) {
      dispatchFrame(trailing);
    }

    if (!doneCalled) {
      doneCalled = true;
      handlers.onDone?.();
    }
  } finally {
    reader.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function safeReadError(response: Response): Promise<string | null> {
  try {
    const data = await response.json();
    if (typeof data?.detail === 'string') {
      return data.detail;
    }
    if (typeof data?.message === 'string') {
      return data.message;
    }
    return JSON.stringify(data);
  } catch {
    try {
      return await response.text();
    } catch {
      return null;
    }
  }
}

/**
 * Convert a LessonPlan into a clean, well-formatted Markdown document for export.
 */
export function lessonPlanToMarkdown(plan: LessonPlan): string {
  const lines: string[] = [];

  lines.push(`# ${plan.title}`);
  lines.push('');
  lines.push(
    `**Level:** ${plan.level || 'Beginner'} | **Duration:** ${plan.duration_min} min | **Audience:** ${plan.audience || 'All'}`
  );
  lines.push('');

  if (plan.objectives.length > 0) {
    lines.push('## Learning Objectives');
    lines.push('');
    for (const obj of plan.objectives) {
      lines.push(`- [ ] ${obj}`);
    }
    lines.push('');
  }

  if (plan.prerequisites && plan.prerequisites.length > 0) {
    lines.push('## Prerequisites');
    lines.push('');
    for (const pre of plan.prerequisites) {
      lines.push(`- ${pre}`);
    }
    lines.push('');
  }

  if (plan.outline.length > 0) {
    lines.push('## Timed Lesson Outline');
    lines.push('');
    for (const item of plan.outline) {
      lines.push(
        `### ${item.start_min}–${item.end_min} min · [${item.type.toUpperCase()}] ${item.title}`
      );
      lines.push('');
      lines.push(item.description);
      lines.push('');
      if (item.example_prompt) {
        lines.push('**Example Prompt:**');
        lines.push('```text');
        lines.push(item.example_prompt);
        lines.push('```');
        lines.push('');
      }
    }
  }

  if (plan.assessment && plan.assessment.length > 0) {
    lines.push('## Assessment');
    lines.push('');
    for (const item of plan.assessment) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }

  if (plan.further_reading && plan.further_reading.length > 0) {
    lines.push('## Further Reading');
    lines.push('');
    for (const item of plan.further_reading) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }

  if (plan.citations && plan.citations.length > 0) {
    lines.push('## Citations');
    lines.push('');
    for (const c of plan.citations) {
      const linkPart = c.url ? ` — [Source link](${c.url})` : '';
      lines.push(`- **[${c.n}]** ${c.title} (p. ${c.page})${linkPart}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

