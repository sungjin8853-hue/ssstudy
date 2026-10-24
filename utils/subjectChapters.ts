import type { Subject, SubjectChapter } from '../types';

/**
 * 단원: 과목을 만들 때 미리 정해 둔 공부 범위들(`1~10, 20~30`). 페이지 순서대로 단원이라 부른다.
 * 단원 사이(11~19)는 공부하지 않으므로, 끝 페이지 · 푼 장수 · 진척도는 모두 단원 안의 페이지만 센다.
 * 단원은 겹치지 않고 페이지 순서로 놓인다. 모든 함수는 정규화된 단원(normalizeChapters)을 받는다.
 */

/** 저장된 값을 안전한 단원 목록으로: 정수 · 시작 1 이상 · 끝 ≥ 시작 · 시작 순서 · 겹치지 않게(앞 단원 끝 다음부터) */
export const normalizeChapters = (value: unknown): SubjectChapter[] => {
  if (!Array.isArray(value)) return [];
  const parsed = value
    .map(item => ({ startPage: Math.round(Number((item as SubjectChapter)?.startPage)), endPage: Math.round(Number((item as SubjectChapter)?.endPage)) }))
    .filter(item => Number.isFinite(item.startPage) && Number.isFinite(item.endPage) && item.startPage >= 1 && item.endPage >= item.startPage)
    .sort((a, b) => a.startPage - b.startPage || a.endPage - b.endPage);
  const result: SubjectChapter[] = [];
  parsed.forEach(item => {
    const previousEnd = result.length > 0 ? result[result.length - 1].endPage : 0;
    const startPage = Math.max(item.startPage, previousEnd + 1);
    if (startPage <= item.endPage) result.push({ startPage, endPage: item.endPage });
  });
  return result;
};

export const getSubjectChapters = (subject: Pick<Subject, 'chapters'>): SubjectChapter[] => normalizeChapters(subject.chapters);

/** "1~10, 20~30" */
export const formatChapters = (chapters: readonly SubjectChapter[]) => chapters.map(item => `${item.startPage}~${item.endPage}`).join(', ');

export interface ChapterParse { chapters: SubjectChapter[]; error: string | null }

/** 쓴 글(`1~10, 20~30`)을 단원 목록으로. 읽을 수 없거나 겹치면 어디가 문제인지 error에 담는다. 비어 있으면 단원 없음(오류 아님). */
export const parseChapterText = (text: string): ChapterParse => {
  const tokens = text.split(/[,，;\n]+/).map(token => token.trim()).filter(Boolean);
  const chapters: SubjectChapter[] = [];
  for (const token of tokens) {
    const range = token.match(/^[pP.]*\s*(\d+)\s*[~∼\-–—]\s*[pP.]*\s*(\d+)$/);
    const single = token.match(/^[pP.]*\s*(\d+)$/);
    if (!range && !single) return { chapters: [], error: `"${token}"을 읽을 수 없어요. 1~10, 20~30처럼 써 주세요.` };
    const startPage = Number(range ? range[1] : single![1]);
    const endPage = Number(range ? range[2] : single![1]);
    if (startPage < 1) return { chapters: [], error: `"${token}": 시작 페이지는 1 이상이에요.` };
    if (endPage < startPage) return { chapters: [], error: `"${token}": 끝 페이지가 시작 페이지보다 작아요.` };
    chapters.push({ startPage, endPage });
  }
  chapters.sort((a, b) => a.startPage - b.startPage);
  for (let index = 1; index < chapters.length; index += 1) {
    if (chapters[index].startPage <= chapters[index - 1].endPage) {
      return { chapters: [], error: `${chapters[index - 1].startPage}~${chapters[index - 1].endPage}과 ${chapters[index].startPage}~${chapters[index].endPage}가 겹쳐요.` };
    }
  }
  return { chapters, error: null };
};

export const chaptersPageCount = (chapters: readonly SubjectChapter[]) => chapters.reduce((sum, item) => sum + (item.endPage - item.startPage + 1), 0);

/** 그 페이지까지(포함) 단원 안에 든 페이지 수 */
export const pagesThrough = (chapters: readonly SubjectChapter[], page: number) => chapters.reduce(
  (sum, item) => sum + Math.max(0, Math.min(page, item.endPage) - item.startPage + 1), 0);

/** 시작~끝 페이지(포함) 사이에서 단원 안에 든 페이지 수: 단원 사이를 건너뛴 만큼 빠진다 */
export const pagesBetween = (chapters: readonly SubjectChapter[], startPage: number, endPage: number) => (
  Math.max(0, pagesThrough(chapters, endPage) - pagesThrough(chapters, startPage - 1)));

/** 단원 안 페이지를 순서대로 셀 때 n번째(1부터) 페이지 번호. n이 전체보다 크면 마지막 끝 페이지, 1보다 작으면 null */
export const pageAtCount = (chapters: readonly SubjectChapter[], n: number): number | null => {
  if (chapters.length === 0 || !(n >= 1)) return null;
  let left = Math.floor(n);
  for (const item of chapters) {
    const size = item.endPage - item.startPage + 1;
    if (left <= size) return item.startPage + left - 1;
    left -= size;
  }
  return chapters[chapters.length - 1].endPage;
};

/** 그 페이지 다음에 공부할 단원 안 페이지. 더 없으면 null */
export const nextPageAfter = (chapters: readonly SubjectChapter[], page: number): number | null => {
  for (const item of chapters) {
    if (page < item.startPage) return item.startPage;
    if (page < item.endPage) return page + 1;
  }
  return null;
};

/**
 * 시작 페이지에서 count장을 풀었을 때 끝 페이지(마지막으로 푼 페이지). 단원 끝을 넘으면 다음 단원 시작부터 이어서 센다.
 * 예) 단원 1~10, 20~30에서 8쪽부터 4장 → 8, 9, 10, 20 → 20. 시작이 단원 사이에 있으면 다음 단원 시작부터.
 */
export const endPageForSolved = (chapters: readonly SubjectChapter[], startPage: number, count: number): number | null => {
  if (!(count >= 1)) return null;
  return pageAtCount(chapters, pagesThrough(chapters, startPage - 1) + Math.floor(count));
};

/** 시작 페이지에서 count장을 푼 뒤 "다음에 풀 페이지"(진척도의 현재 위치). 마지막 끝 페이지를 넘지 않는다. count가 0이면 시작 페이지 그대로 */
export const positionAfterSolved = (chapters: readonly SubjectChapter[], startPage: number, count: number): number => {
  if (!(count >= 1)) return startPage;
  const last = endPageForSolved(chapters, startPage, count);
  if (last === null) return startPage;
  return nextPageAfter(chapters, last) ?? last;
};

/** 그 페이지가 든 단원의 번호(0부터). 단원 사이면 다음 단원, 마지막 단원 뒤면 -1 */
export const chapterIndexAtOrAfter = (chapters: readonly SubjectChapter[], page: number) => chapters.findIndex(item => page <= item.endPage);

/** 그 페이지 뒤에 시작하는 가장 가까운 단원의 시작 페이지. 없으면 null */
export const nextChapterStart = (chapters: readonly SubjectChapter[], page: number): number | null => (
  chapters.find(item => item.startPage > page)?.startPage ?? null);

export interface CurrentChapter {
  /** 1부터 세는 단원 번호 */
  number: number;
  total: number;
  startPage: number;
  endPage: number;
  pageCount: number;
  /** 이 단원에서 푼 페이지 수 */
  completedCount: number;
  /** 이 단원 다음 단원의 시작 페이지(마지막 단원이면 null) */
  nextStartPage: number | null;
}

/**
 * 지금 공부하는 단원: 다음에 풀 페이지가 든 단원이다. 단원 끝까지 풀면 바로 다음 단원으로 넘어가 진척도가 새 단원 값(0)으로 바뀐다.
 * 모든 단원을 끝냈으면 마지막 단원(모두 푼 상태).
 */
export const getCurrentChapter = (chapters: readonly SubjectChapter[], completedPage: number): CurrentChapter | null => {
  if (chapters.length === 0) return null;
  const upcoming = nextPageAfter(chapters, completedPage);
  const index = upcoming === null ? chapters.length - 1 : chapters.findIndex(item => upcoming >= item.startPage && upcoming <= item.endPage);
  const chapter = chapters[index];
  const pageCount = chapter.endPage - chapter.startPage + 1;
  return {
    number: index + 1, total: chapters.length, startPage: chapter.startPage, endPage: chapter.endPage, pageCount,
    completedCount: Math.min(pageCount, Math.max(0, Math.min(completedPage, chapter.endPage) - chapter.startPage + 1)),
    nextStartPage: chapters[index + 1]?.startPage ?? null
  };
};

/**
 * 측정 중 진행 칸: 지금 풀 차례인 페이지(current)와 이번 뽀모도로의 끝 페이지(goal)를 단원 기준으로 나눈다.
 * 끝 페이지가 지금 단원 안이면 그대로 한 칸: current ~ goal.
 * 끝 페이지가 지금 단원 끝을 넘으면 두 칸: 지금 단원은 current / 그 단원 끝, 다음 단원은 그 시작 / 이번 뽀모도로에서 그 단원에 풀 마지막 페이지(goal 또는 그 단원 끝).
 * 예) 단원 1~10, 20~30에서 9쪽부터 12장(끝 페이지 29) → 9/10 · 다음 단원 20/29.
 * current가 단원 사이면 다음 단원 시작부터, 마지막 단원 뒤면 마지막 단원으로 본다.
 */
export interface ChapterSplit {
  /** 지금 하는 단원(1부터 센 번호) · 범위 */
  chapter: { number: number; startPage: number; endPage: number };
  current: { page: number; end: number };
  /** 이번 뽀모도로가 단원 끝을 넘을 때만 있다 */
  next: { number: number; page: number; end: number } | null;
}

export const splitByChapter = (chapters: readonly SubjectChapter[], current: number, goal: number): ChapterSplit | null => {
  if (chapters.length === 0) return null;
  const found = chapterIndexAtOrAfter(chapters, current);
  const index = found < 0 ? chapters.length - 1 : found;
  const chapter = chapters[index];
  const upcoming = chapters[index + 1];
  const info = { number: index + 1, startPage: chapter.startPage, endPage: chapter.endPage };
  if (!upcoming || goal <= chapter.endPage) return { chapter: info, current: { page: current, end: goal }, next: null };
  return {
    chapter: info,
    current: { page: current, end: chapter.endPage },
    next: { number: index + 2, page: upcoming.startPage, end: Math.min(goal, upcoming.endPage) }
  };
};
