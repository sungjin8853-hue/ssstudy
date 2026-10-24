import { REVIEW_MEMO_TOGGLE_END, REVIEW_MEMO_TOGGLE_START } from './reviewMemo';
import { isReviewGroupClose, isReviewGroupOpen } from './reviewFieldOverride';
import { reviewQuotes } from './reviewQuote';
import { isNoteShorthandOn } from './noteShorthand';

/**
 * 맨 끝이 덜 끝난 관계 논리.
 *  - 연결어(`:` `;` `<`)나 논리관계어(`,` `-` `=`)로 글이 끝나면 그 글은 아직 끝나지 않은 것이라, 바로 밑 줄이 토글 아래 줄처럼 이어진다.
 *  - 연결어로 끝나면 아래 줄들은 행 단위로 "또는"이 기본이다. 맨 끝에 논리관계어를 더 붙이면(`A :,`) 그 논리로 이어진다: `,` 그리고 · `-` 순서 · `=` 같음.
 *  - 논리관계어만으로 끝나도(`A,`) 아래 줄이 같은 칸 안에서 그 논리로 이어진다.
 */
export interface OpenTail {
  connector?: ':' | ';' | '<';
  logic?: ',' | '-' | '=';
  /** 꼬리가 시작하는 글자 위치(연결어가 있으면 연결어, 없으면 논리관계어) */
  start: number;
  /** 꼬리가 끝나는 위치(끝 공백을 뺀 글 길이) */
  end: number;
}

const isConnector = (character: string | undefined): character is ':' | ';' | '<' => character === ':' || character === ';' || character === '<';

/** 글 맨 끝의 덜 끝난 관계. 괄호·대괄호 안이나 따옴표 안의 기호, 글 앞에 아무것도 없는 기호는 꼬리가 아니다. */
export const openTailOf = (text: string): OpenTail | null => {
  let end = text.length;
  while (end > 0 && /\s/.test(text[end - 1])) end -= 1;
  if (end === 0) return null;
  const quoted = reviewQuotes(text).marks;
  // 닫히지 않은 괄호 안, 짝이 맞는 괄호 안, 따옴표 안의 기호는 맨 끝 꼬리가 아니다
  const depth = new Int16Array(text.length + 1);
  for (let index = 0; index < text.length; index += 1) {
    depth[index + 1] = Math.max(0, depth[index] + (isReviewGroupOpen(text[index]) ? 1 : isReviewGroupClose(text[index]) ? -1 : 0));
  }
  const free = (index: number) => !quoted.has(index) && depth[index] === 0;
  const hasContent = (before: number) => text.slice(0, before).trim().length > 0;
  // `A :{이름}`처럼 연결어 뒤에 칸 이름만 있는 끝
  const named = /([:;<])\s*\{[^{}\n]*\}\s*([,\-=])?$/.exec(text.slice(0, end));
  if (named && free(named.index) && hasContent(named.index)) {
    const logic = named[2] && (named[2] === ',' || isNoteShorthandOn()) ? named[2] as ',' | '-' | '=' : undefined;
    return { connector: named[1] as ':' | ';' | '<', ...(logic ? { logic } : {}), start: named.index, end };
  }
  const last = text[end - 1];
  if (isConnector(last) && free(end - 1) && hasContent(end - 1)) return { connector: last, start: end - 1, end };
  if ((last === ',' || ((last === '-' || last === '=') && isNoteShorthandOn())) && free(end - 1)) {
    let before = end - 2;
    while (before >= 0 && /\s/.test(text[before])) before -= 1;
    if (before >= 0 && isConnector(text[before]) && free(before) && hasContent(before)) {
      return { connector: text[before] as ':' | ';' | '<', logic: last, start: before, end };
    }
    if (hasContent(end - 1)) return { logic: last, start: end - 1, end };
  }
  return null;
};

/** 제목 끝의 논리관계어(`A :,`의 `,`)를 같은 길이의 빈칸으로 바꾼다. 글자 위치는 그대로라 문제 만들기가 그것을 글로 읽지 않는다. */
export const blankOpenLogic = (title: string): string => {
  const tail = openTailOf(title);
  if (!tail?.logic) return title;
  const at = title.lastIndexOf(tail.logic, tail.end - 1);
  return at < 0 ? title : `${title.slice(0, at)} ${title.slice(at + 1)}`;
};

const toggleEnd = (lines: readonly string[], from: number): number => {
  let depth = 1;
  for (let cursor = from + 1; cursor < lines.length; cursor += 1) {
    if (lines[cursor].startsWith(REVIEW_MEMO_TOGGLE_START)) depth += 1;
    else if (lines[cursor] === REVIEW_MEMO_TOGGLE_END) depth -= 1;
    if (depth === 0) return cursor;
  }
  return -1;
};

/**
 * 맨 끝이 덜 끝난 줄은 바로 밑 줄(밑이 토글이면 그 토글 전체)을 토글 아래 줄처럼 품는다: 그 줄을 제목으로 하는 토글로 바꿔 쓴다.
 * 위치에 관계없이(토글 안이든 밖이든) 가장 먼저 처리한다. 이미 쓴 토글은 그대로이고, 밑 줄이 없거나 비었거나 토글 끝이면 그대로 둔다.
 * 문제 만들기·관계도·집합 읽기가 이 글을 쓰고, 노트에 저장된 글은 바뀌지 않는다.
 */
export const expandOpenLines = (memo: string): string => {
  if (!memo || !/[:;<,\-=}]\s*\n/.test(memo)) return memo;
  const unit = (list: readonly string[], index: number): { lines: string[]; next: number } => {
    const line = list[index];
    if (line.startsWith(REVIEW_MEMO_TOGGLE_START)) {
      const end = toggleEnd(list, index);
      if (end < 0) return { lines: [line], next: index + 1 };
      return { lines: [line, ...each(list.slice(index + 1, end)), list[end]], next: end + 1 };
    }
    const following = list[index + 1];
    if (line === REVIEW_MEMO_TOGGLE_END || !openTailOf(line) || following === undefined || !following.trim() || following === REVIEW_MEMO_TOGGLE_END) {
      return { lines: [line], next: index + 1 };
    }
    const child = unit(list, index + 1);
    return { lines: [`${REVIEW_MEMO_TOGGLE_START}${line}`, ...child.lines, REVIEW_MEMO_TOGGLE_END], next: child.next };
  };
  const each = (list: readonly string[]): string[] => {
    const result: string[] = [];
    for (let index = 0; index < list.length;) {
      const taken = unit(list, index);
      result.push(...taken.lines);
      index = taken.next;
    }
    return result;
  };
  return each(memo.split('\n')).join('\n');
};
