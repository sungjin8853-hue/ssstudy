import type { StudyLog } from '../types';
import { pageUnitIndex } from './pageGrowth';
import { getLogStudyDate } from './schedule';

/**
 * 정리노트는 "쪽" 단위로 나눠 보여 준다. 쪽은 앞에서 뒤로(오래된 것 → 최신) 놓이고, 노트를 열면 맨 뒤 쪽에서 시작한다.
 *  - 한 번의 학습(기록)이 쓴 노트가 가장 작은 조각이고, 쪽은 그 조각들을 이어 붙여 만든다(쪽 안에서도 오래된 기록이 위, 최신이 아래).
 *  - 과목에 페이지 단위(예: 10P)가 있으면 단위마다 한 쪽이다. 화면에서 보는 단위는 학습 실행의 "다음 단위까지"와 같다.
 *    · 기록이 어느 단위에 속하는지는 효율 계산과 같이 "끝 페이지"로 정한다(단위는 책의 첫 페이지부터 unitSize쪽씩).
 *    · 시작 페이지는 앞 단위인데 끝 페이지가 다음 단위인 기록(한 번의 학습이 단위를 넘어간 기록)은
 *      끝 페이지가 있는 단위 쪽에 한 번만 넣고, spanning에 표시한다(두 쪽에 겹쳐 넣지 않는다).
 *    · 페이지를 적지 않은 기록은 그보다 앞선 기록과 같은 단위에 둔다(맨 앞이면 처음으로 페이지가 있는 기록의 단위).
 *  - 페이지 단위가 없는 과목(unitSize 0)이나 페이지를 적은 기록이 하나도 없는 과목은 학습한 날(하루)마다 한 쪽이다.
 */
export interface NoteUnitPage {
  key: string;
  /** 'unit'은 페이지 단위 한 쪽, 'day'는 하루 한 쪽 */
  kind: 'unit' | 'day';
  /** 0부터 센 단위 번호. 하루 쪽이면 null */
  index: number | null;
  /** 단위 쪽의 첫 페이지와 마지막 페이지 */
  start?: number;
  end?: number;
  /** 하루 쪽의 학습한 날(YYYY-MM-DD) */
  day?: string;
  /** 이 쪽의 기록. 오래된 것이 먼저, 최신이 맨 뒤 */
  logs: StudyLog[];
  /** 앞 단위에서 시작해 이 단위에서 끝난 기록의 id */
  spanning: string[];
}

const timeOf = (log: StudyLog) => {
  const value = Date.parse(log.timestamp);
  return Number.isFinite(value) ? value : 0;
};

const byTime = (a: StudyLog, b: StudyLog) => timeOf(a) - timeOf(b) || a.id.localeCompare(b.id);

/** 학습한 날마다 한 쪽. 날짜 순서(오래된 날 → 최근 날)로 놓는다. */
const groupLogsByDay = (chronological: StudyLog[], scope: string): NoteUnitPage[] => {
  const byDay = new Map<string, StudyLog[]>();
  chronological.forEach(log => {
    const day = getLogStudyDate(log);
    byDay.set(day, [...(byDay.get(day) ?? []), log]);
  });
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, items]): NoteUnitPage => ({ key: `${scope}:day:${day}`, kind: 'day', index: null, day, logs: items, spanning: [] }));
};

export const groupLogsByPageUnit = (logs: StudyLog[], unitSize: number, firstPage = 1, scope = 'notes'): NoteUnitPage[] => {
  if (!logs.length) return [];
  const chronological = [...logs].sort(byTime);
  if (!(unitSize > 0)) return groupLogsByDay(chronological, scope);
  const first = Number.isFinite(firstPage) ? firstPage : 1;
  const unitOf = new Map<string, number | null>();
  let previous: number | null = null;
  chronological.forEach(log => {
    const unit = Number.isFinite(log.endPage) ? pageUnitIndex(log.endPage!, unitSize, first) : previous;
    unitOf.set(log.id, unit);
    if (unit !== null) previous = unit;
  });
  const firstKnown = chronological.map(log => unitOf.get(log.id)).find((unit): unit is number => typeof unit === 'number');
  if (firstKnown === undefined) return groupLogsByDay(chronological, scope);
  const byUnit = new Map<number, StudyLog[]>();
  chronological.forEach(log => {
    const unit = unitOf.get(log.id) ?? firstKnown;
    byUnit.set(unit, [...(byUnit.get(unit) ?? []), log]);
  });
  return [...byUnit.entries()]
    .map(([index, items]): NoteUnitPage => ({
      key: `${scope}:unit:${index}`, kind: 'unit', index,
      start: first + index * unitSize, end: first + (index + 1) * unitSize - 1,
      logs: items,
      spanning: items.filter(log => Number.isFinite(log.startPage) && Number.isFinite(log.endPage)
        && pageUnitIndex(log.startPage!, unitSize, first) < pageUnitIndex(log.endPage!, unitSize, first)).map(log => log.id)
    }))
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
};

/** 노트를 열 때 보여 주는 쪽: 맨 뒤 쪽(가장 뒤의 단위·가장 최근의 날). */
export const lastPageIndex = (pages: readonly unknown[]): number => Math.max(0, pages.length - 1);

/* ───────── 쪽 나누기: 구역(단위·하루)을 쪽당 행 수 상한에 맞춰 담는다 ───────── */

/**
 * 한 쪽에 담는 행 수의 상한(종이 격자 한 칸 = 한 행). 쪽마다 이 행 수 이하만 담기고,
 * 구역(페이지 단위 또는 하루)이 짧으면 한 쪽에 두 구역 이상이 함께 들어간다.
 */
export const NOTE_PAGE_ROWS = 12;
/** 구역 제목(몇 번째 단위 / 날짜) 1행, 구역과 구역 사이 1행, 한 구역 안 기록과 기록 사이 1행, 칩(앞 단위에서 이어진 기록) 1행 */
const HEADING_ROWS = 1;
const SECTION_GAP_ROWS = 1;
const ENTRY_GAP_ROWS = 1;
const CHARS_PER_ROW = 34;

const visualWidth = (text: string) => [...text].reduce((sum, char) => sum + (char.charCodeAt(0) > 0x2e7f ? 1 : 0.55), 0);

/**
 * 노트 한 기록이 종이에서 차지하는 행 수(줄이 길어 접히는 것까지 어림). 토글을 닫는 줄(:::end)은 화면에 행이 없다.
 * 비어 있어도 1행(입력 줄)이다.
 */
export const estimateMemoRows = (memo?: string): number => {
  const lines = (memo ?? '').replace(/\r\n?/g, '\n').split('\n').filter(line => line.trim() !== ':::end');
  const body = lines.map(line => line.replace(/^:::toggle\s*/, ''));
  while (body.length > 1 && !body[body.length - 1].trim()) body.pop();
  return Math.max(1, body.reduce((sum, line) => sum + Math.max(1, Math.ceil(visualWidth(line) / CHARS_PER_ROW)), 0));
};

export interface NoteSheetEntry {
  log: StudyLog;
  /** 앞 단위에서 시작해 이 단위에서 끝난 기록 */
  spanning: boolean;
}

export interface NoteSheetSection {
  key: string;
  kind: 'unit' | 'day';
  /** 0부터 센 단위 번호(화면에는 index + 1번째 단위). 하루 구역이면 null */
  index: number | null;
  start?: number;
  end?: number;
  day?: string;
  /** 앞 쪽에서 이어진 구역(구역이 한 쪽보다 길어 나뉜 경우) */
  continued: boolean;
  entries: NoteSheetEntry[];
}

export interface NoteSheetPage {
  key: string;
  sections: NoteSheetSection[];
  /** 이 쪽이 차지하는 행 수 */
  rows: number;
}

const entriesOf = (section: NoteUnitPage, logs: StudyLog[]): NoteSheetEntry[] => {
  return logs.map(log => ({ log, spanning: section.spanning.includes(log.id) }));
};

/**
 * 구역(단위·하루)들을 앞에서부터 쪽에 담는다. 쪽마다 maxRows 행 이하:
 *  - 구역은 제목 1행 + 기록들(기록 사이 1행, 이어진 기록 칩이 있으면 1행, 노트 줄 수)로 센다. 구역과 구역 사이는 1행.
 *  - 짧은 구역은 한 쪽에 여러 개가 들어가고, 남은 자리에 못 들어가는 구역은 다음 쪽으로 간다(한 쪽에 통째로 들어갈 때).
 *  - 한 쪽보다 긴 구역은 기록 단위로 나눠 여러 쪽에 걸친다(뒤 쪽의 제목에 "이어서").
 *  - 기록 하나가 한 쪽보다 길면 그 기록 혼자 한 쪽을 쓴다(그 쪽은 안에서 스크롤).
 * rowsOf로 기록의 행 수를 따로 정할 수 있다(편집하는 동안 쪽이 바뀌지 않게 열 때 센 값을 계속 쓰려고).
 */
export const paginateNoteSections = (
  sections: NoteUnitPage[],
  maxRows: number = NOTE_PAGE_ROWS,
  rowsOf: (log: StudyLog) => number = log => estimateMemoRows(log.reviewMemo)
): NoteSheetPage[] => {
  const pages: NoteSheetPage[] = [];
  let current: NoteSheetSection[] = [];
  let used = 0;
  const closePage = () => {
    if (!current.length) return;
    const head = current[0].entries[0]?.log.id ?? current[0].key;
    pages.push({ key: `page:${current[0].key}:${head}`, sections: current, rows: used });
    current = [];
    used = 0;
  };
  const rowsFor = (section: NoteUnitPage, logs: StudyLog[], gap: number) => gap + HEADING_ROWS
    + entriesOf(section, logs).reduce((sum, entry, index) => sum + (index === 0 ? 0 : ENTRY_GAP_ROWS) + (entry.spanning ? 1 : 0) + rowsOf(entry.log), 0);

  sections.forEach(section => {
    let remaining = section.logs;
    let continued = false;
    while (remaining.length) {
      const gap = current.length ? SECTION_GAP_ROWS : 0;
      let count = 0;
      while (count < remaining.length && used + rowsFor(section, remaining.slice(0, count + 1), gap) <= maxRows) count += 1;
      if (count === 0) {
        if (current.length) { closePage(); continue; }
        count = 1;
      } else if (count < remaining.length && !continued && current.length && rowsFor(section, remaining, 0) <= maxRows) {
        closePage();
        continue;
      }
      const taken = remaining.slice(0, count);
      current.push({
        key: section.key, kind: section.kind, index: section.index, start: section.start, end: section.end, day: section.day,
        continued, entries: entriesOf(section, taken)
      });
      used += rowsFor(section, taken, gap);
      remaining = remaining.slice(count);
      if (remaining.length) { closePage(); continued = true; }
    }
  });
  closePage();
  return pages;
};

/**
 * 지금 학습 중인 과목의 "이어 쓰는 노트지".
 *  - 페이지 단위가 있으면 가장 최근 기록이 속한 단위 쪽의 기록들이다. 그 기록이 단위의 마지막 페이지까지 갔으면
 *    그 단위는 끝난 것이므로 이어 쓰지 않고(빈 새 노트지) 다음 학습부터 새 단위가 시작된다.
 *  - 페이지 단위가 없으면 오늘(studyDate) 학습한 기록들이다. 날이 바뀌면 새 노트지가 된다.
 * logs는 이 과목의 기록 전체(노트가 없는 기록 포함)를 넣는다. 반환은 오래된 순서.
 */
export const carriedNoteLogs = (logs: StudyLog[], unitSize: number, firstPage: number, studyDate: string): StudyLog[] => {
  if (!logs.length) return [];
  const pages = groupLogsByPageUnit(logs, unitSize, firstPage, 'carry');
  if (!pages.length) return [];
  if (pages[0].kind === 'unit') {
    const latest = [...logs].sort(byTime).pop()!;
    const page = pages.find(item => item.logs.some(log => log.id === latest.id));
    if (!page || page.end === undefined) return [];
    if (Number.isFinite(latest.endPage) && latest.endPage! >= page.end) return [];
    return page.logs;
  }
  return pages.find(page => page.day === studyDate)?.logs ?? [];
};
