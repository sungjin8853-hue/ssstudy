/**
 * 줄 맨 앞에 글자처럼 보이는 위치 `[..B]`(저장하지 않는 보이기용)를 편집창 글에 끼워 넣고 걷어 내는 도구.
 *
 * 보이는 글 = 저장하는 글에 줄마다 `MARK + 위치 + ' ' + MARK`를 맨 앞에 끼운 것이다. MARK(`⁠`, 폭이 없는 글자)가 앞뒤를 가르므로
 * 끼운 글만 정확히 걷어 낼 수 있다. 모든 위치·커서 계산은 저장하는 글 기준(stored)과 보이는 글 기준(display)을 서로 바꾸어 쓴다.
 *  - MARK 짝은 글쓴이가 칠 수 없으므로 어디에 있든 끼운 글이다. 줄 맨 앞이 아닌 곳(줄이 합쳐져 옮겨진 것)의 짝은 글자째 버린다.
 *  - 앞뒤 MARK 중 하나가 지워져 위치 글자만 남은 줄은(expected: 그 줄에 끼웠던 위치) 남은 위치 글자도 함께 걷는다.
 *  - 그 밖의 MARK는 하나씩 걷는다.
 */
export const GHOST_MARK = '⁠';

export interface GhostInsert { line: number; label: string }
export interface GhostSpan { start: number; end: number; label: string; line: number }
interface Range { start: number; end: number }

const HEAD = /^⁠(\[[^⁠\n]*\]) ⁠/;
const ANY = /⁠(?:\[[^⁠\n]*\] ⁠)?/g;

/** 저장하는 글의 줄마다(ghosts의 줄 번호) 맨 앞에 위치를 끼운 보이는 글 */
export const insertGhosts = (text: string, ghosts: readonly GhostInsert[]): string => {
  if (!ghosts.length) return text;
  const byLine = new Map(ghosts.map(item => [item.line, item.label]));
  return text.split('\n').map((line, at) => (byLine.has(at) ? `${GHOST_MARK}${byLine.get(at)} ${GHOST_MARK}${line}` : line)).join('\n');
};

/** 걷어 낼 자리들(순서대로, 겹치지 않음)과 줄 맨 앞의 온전한 끼운 글들 */
const scan = (display: string, expected?: ReadonlyMap<number, string>): { ranges: Range[]; spans: GhostSpan[] } => {
  const ranges: Range[] = [];
  const spans: GhostSpan[] = [];
  if (!display.includes(GHOST_MARK)) return { ranges, spans };
  let lineStart = 0;
  let line = 0;
  while (lineStart <= display.length) {
    const found = display.indexOf('\n', lineStart);
    const lineEnd = found < 0 ? display.length : found;
    const text = display.slice(lineStart, lineEnd);
    if (text.includes(GHOST_MARK)) {
      let from = 0;
      const head = HEAD.exec(text);
      const label = expected?.get(line);
      if (head) {
        ranges.push({ start: lineStart, end: lineStart + head[0].length });
        spans.push({ start: lineStart, end: lineStart + head[0].length, label: head[1], line });
        from = head[0].length;
      } else if (label !== undefined) {
        // 한쪽 MARK만 지워진 줄: 남은 위치 글자도 끼운 글의 남은 조각이다
        const shown = `${label} `;
        if (text.startsWith(`${GHOST_MARK}${shown}`)) { ranges.push({ start: lineStart, end: lineStart + 1 + shown.length }); from = 1 + shown.length; }
        else if (text.startsWith(`${shown}${GHOST_MARK}`)) { ranges.push({ start: lineStart, end: lineStart + shown.length + 1 }); from = shown.length + 1; }
      }
      ANY.lastIndex = from;
      for (let match = ANY.exec(text); match; match = ANY.exec(text)) ranges.push({ start: lineStart + match.index, end: lineStart + match.index + match[0].length });
    }
    if (found < 0) break;
    lineStart = found + 1;
    line += 1;
  }
  return { ranges, spans };
};

/** 보이는 글에서 줄 맨 앞에 온전히 남아 있는 끼운 글들의 자리 */
export const ghostSpans = (display: string, expected?: ReadonlyMap<number, string>): GhostSpan[] => scan(display, expected).spans;

/** 보이는 글에서 끼운 글을 걷어 낸 저장하는 글 */
export const stripGhosts = (display: string, expected?: ReadonlyMap<number, string>): string => {
  const { ranges } = scan(display, expected);
  if (!ranges.length) return display;
  let result = '';
  let at = 0;
  ranges.forEach(range => { result += display.slice(at, range.start); at = range.end; });
  return result + display.slice(at);
};

/** 보이는 글의 자리 → 저장하는 글의 자리 (끼운 글 안의 자리는 그 줄 맨 앞이 된다) */
export const storedOffset = (display: string, offset: number, expected?: ReadonlyMap<number, string>): number => {
  let removed = 0;
  for (const range of scan(display, expected).ranges) {
    if (range.end <= offset) removed += range.end - range.start;
    else { if (range.start < offset) removed += offset - range.start; break; }
  }
  return offset - removed;
};

/** 저장하는 글의 자리 → 보이는 글의 자리. 줄 맨 앞이면 그 줄 끼운 글의 뒤쪽이다(커서는 위치 글자 뒤에 놓인다). */
export const displayOffset = (display: string, stored: number, expected?: ReadonlyMap<number, string>): number => {
  let shift = 0;
  for (const range of scan(display, expected).ranges) {
    if (range.start - shift <= stored) shift += range.end - range.start;
    else break;
  }
  return stored + shift;
};

/**
 * 커서(선택)가 끼운 글을 반쯤 걸치지 않게 고친 자리. 바꿀 것이 없으면 null.
 *  - 커서 하나: 끼운 글 안(앞 포함, 뒤 제외)이면 끼운 글 뒤로.
 *  - 범위: 시작이 끼운 글 안(앞 제외)이면 뒤로, 끝이 끼운 글 안(뒤 제외)이면 앞으로. 줄 맨 앞부터 고른 것은 끼운 글째 고른 것이다.
 */
export const normalizeSelection = (display: string, start: number, end: number, expected?: ReadonlyMap<number, string>): { start: number; end: number } | null => {
  const spans = ghostSpans(display, expected);
  if (!spans.length) return null;
  if (start === end) {
    const hit = spans.find(span => span.start <= start && start < span.end);
    return hit ? { start: hit.end, end: hit.end } : null;
  }
  let nextStart = start;
  let nextEnd = end;
  const startHit = spans.find(span => span.start < start && start < span.end);
  if (startHit) nextStart = startHit.end;
  const endHit = spans.find(span => span.start < end && end < span.end);
  if (endHit) nextEnd = endHit.start;
  if (nextStart >= nextEnd) nextEnd = nextStart;
  return nextStart === start && nextEnd === end ? null : { start: nextStart, end: nextEnd };
};

/** 커서가 정확히 끼운 글 바로 뒤(줄 맨 앞 글자 앞)에 있을 때의 그 끼운 글 */
export const ghostEndingAt = (display: string, offset: number, expected?: ReadonlyMap<number, string>): GhostSpan | null =>
  ghostSpans(display, expected).find(span => span.end === offset) ?? null;
