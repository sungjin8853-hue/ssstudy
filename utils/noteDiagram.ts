import { parseReviewMemoBlocks } from './reviewMemo';
import { getReviewFieldOverrides, readReviewFieldOverride, reviewGroups } from './reviewFieldOverride';
import { isReviewSequenceSeparator } from './reviewMemoLogic';
import { isReviewSlash } from './reviewSlash';
import { matchingBracket, parseMemberList } from './setExpression';
import { isNoteShorthandOn, relationClass, relationMarks } from './noteShorthand';
import { quotedMarkCuts, reviewQuotes } from './reviewQuote';
import { normalizeNotePunctuation } from './notePunctuation';
import { blankOpenLogic, expandOpenLines, openTailOf } from './noteOpenTail';

/**
 * 정리노트 글을 관계도(화면 표시용)로 바꾼다. 문제 만들기와는 별개이고, 값을 저장하거나 바꾸지 않는다.
 *  - `:` 양방향, `;` 앞으로만(충분조건: 왼쪽을 보고 오른쪽을 떠올린다), `<` 거꾸로만(역관계: 오른쪽을 보고 왼쪽을 떠올린다), `=`는 한 칸 안의 논리어라 칸을 나누지 않고(`A:B=C`는 A와 `B=C` 두 칸), `//` 같은 줄 구분(한 번만 쓴 `/`는 그냥 글자), `( )` 안의 기호는 칸을 나누지 않는다.
 *  - 토글(`>`)은 제목에 따라 네 가지로 읽는다.
 *      `>A:` + 아래 줄들   → `A:B` 와 같다. 줄을 바꾼 각 줄은 서로 "또는" (fan, or)
 *      `>A`  + 아래 줄들   → A 안에 B가 들어 있는 상하관계 (group, hierarchy)
 *      `>A:C` + `B:D` 줄들 → A:C 아래에 B:D가 포함된 포함관계 (group, containment).
 *                          A, C는 분류 관점(개념/정의 …)마다의 집합이고 B는 A에, D는 C에 구성요소로 들어간다(fieldLabels).
 *      `>A;` + 아래 줄들   → `A;B,C` 와 같다. 아래 줄이 둘 이상이면 "그리고" 부분관계 (fan, and)
 *  - 토글 제목에 `[개념:정의]` 같은 분류 기준을 (여러 번) 쓰면, 그 토글 안은 마지막 기준으로 읽는다(criteria / labels).
 *    제목 안의 `{이름}`으로 칸 이름만 바꾼 것도 같은 방식으로 이어받는다. 기준이 바뀐 묶음만 labels를 가진다.
 */
export type DiagramArrow = 'both' | 'forward' | 'back';
const arrowOf = (separator: string | undefined): DiagramArrow => (separator === '<' ? 'back' : separator === ';' ? 'forward' : 'both');
export type DiagramOperator = 'and' | 'or' | 'sequence' | 'equal';
/** atValues: `@`(바로 앞 칸)를 풀어 쓴 칸의 번호 → 그 자리에 들어간 앞 칸 값(관계도가 무엇을 가리키는지 보여 준다) */
export interface DiagramRelation { fields: string[]; arrows: DiagramArrow[]; atValues?: Record<number, string> }
export type DiagramItem =
  | ({ kind: 'relation' } & DiagramRelation)
  | { kind: 'plain'; text: string }
  /** `#` 틀 줄·`{A}` 자리 줄: 쓴 글(source)과 그것이 펼쳐 만든 줄들(lines, 문제 만들기가 만든 것과 같다) */
  | { kind: 'expanded'; source: string; lines: DiagramItem[] }
  /** `[X]` 홀로(집합), `[집합식]:[기준]`(능력 정의), `[개념:정의]`(노트 전체 기준)처럼 집합·기준을 적은 줄 */
  | { kind: 'setline'; line: NoteSetLine }
  | { kind: 'fan'; left: string; arrow: DiagramArrow; right: string[]; operator: DiagramOperator; criteria?: string[]; labels?: string[] }
  | { kind: 'group'; relation: 'hierarchy' | 'containment'; title: string; header?: DiagramRelation;
    /** 포함관계 제목 `A:C`의 칸마다 어느 분류 관점(개념/정의 …)의 집합인지. 아래 `B:D`의 B는 A 집합에, D는 C 집합에 들어간다. */
    fieldLabels?: string[];
    /** 아래 항목 사이에 붙는 연결 표시. `>A:`/`>A;`인데 아래에 관계가 섞여 있을 때만 쓴다. */
    connector?: DiagramOperator; items: DiagramItem[];
    /** 제목에 쓴 분류 기준 `[ ]`들(쓴 순서). 마지막 것이 이 묶음 안에서 쓰인다. */
    criteria?: string[];
    /** 이 묶음이 기준을 바꿨을 때, 안쪽에서 쓰이는 칸 이름(바꾸지 않았으면 없다) */
    labels?: string[] };

/** 묶음 괄호 `( )` 바깥(깊이 0)에서 delimiters에 해당하는 글자의 위치. `:`/`;` 바로 뒤의 {분류 이름}은 건너뛴다. */
export const topLevelCuts = (text: string, delimiters: string): number[] => {
  const cuts: number[] = [];
  const groups = reviewGroups(text).skip;
  const quoted = reviewQuotes(text).marks;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    // 따옴표 `'…'` 안의 `:` `;` `<`는 칸을 나누지 않고 한 칸 안의 논리어(`=` `-`)다.
    const role = quoted.get(index);
    if (role) { if (quotedMarkCuts(role, delimiters)) cuts.push(index); continue; }
    const override = character === ':' || character === ';' || character === '<' ? readReviewFieldOverride(text, index + 1) : undefined;
    if (override) {
      if (delimiters.includes(character)) cuts.push(index);
      index = override.end - 1;
      continue;
    }
    const jump = groups.get(index);
    if (jump !== undefined) { index = jump; continue; }
    if (delimiters.includes(character) && (character !== '/' || isReviewSlash(text, index))) cuts.push(index);
  }
  return cuts;
};

const parseRelation = (text: string): DiagramRelation | null => {
  const cuts = topLevelCuts(text, relationMarks());
  if (!cuts.length) return null;
  const bounds = [-1, ...cuts, text.length];
  const fields: string[] = [];
  bounds.slice(1).forEach((end, index) => {
    const start = bounds[index] + 1;
    const override = index > 0 ? readReviewFieldOverride(text, start, end) : undefined;
    fields.push(text.slice(override?.end ?? start, end).trim());
  });
  while (fields.length > 1 && !fields[fields.length - 1]) fields.pop();
  if (fields.length < 2 || !fields[0]) return null;
  // `@`는 바로 앞 칸의 값이다(문제 만들기와 같은 규칙, `[@]` 집합 되부르기는 그대로 둔다): 풀어 쓴 값과 무엇이 들어갔는지를 같이 준다
  const atValues: Record<number, string> = {};
  for (let index = 1; index < fields.length; index += 1) {
    if (!/(^|[^[])@(?!\])/.test(fields[index])) continue;
    const previous = fields[index - 1].replace(/^(\s*\[[^\]]*\]\s*)+/, '').trim();
    if (!previous) continue;
    atValues[index] = previous;
    fields[index] = fields[index].replace(/(^|[^[])@(?!\])/g, (_, before: string) => `${before}${previous}`);
  }
  return { fields, arrows: cuts.slice(0, fields.length - 1).map(cut => arrowOf(text[cut])), ...(Object.keys(atValues).length ? { atValues } : {}) };
};

const parseSegment = (segment: string): DiagramItem | null => {
  const text = segment.trim();
  if (!text) return null;
  const setLine = readNoteSetLine(text);
  if (setLine) return { kind: 'setline', line: setLine };
  const relation = parseRelation(text);
  return relation ? { kind: 'relation', ...relation } : { kind: 'plain', text };
};

/** 틀·자리 줄이 펼쳐 만든 줄들: 쓴 글(칸 글, 앞뒤 공백 없이) → 만든 줄들. 문제 만들기(`generatedLinesOf`)가 준다. */
export type DiagramExpansions = ReadonlyMap<string, readonly string[]>;

const parseLine = (line: string, expansions?: DiagramExpansions): DiagramItem[] => {
  const cuts = topLevelCuts(line, '/');
  const bounds = [-1, ...cuts, line.length];
  return bounds.slice(1).flatMap((end, index) => {
    const segment = line.slice(bounds[index] + 1, end);
    const made = expansions?.get(segment.trim());
    if (made && made.length) return [{ kind: 'expanded', source: segment.trim(), lines: made.flatMap(text => parseLine(text)) }];
    const item = parseSegment(segment);
    return item ? [item] : [];
  });
};

const toggleTail = () => new RegExp(`(${relationClass()})\\s*(\\{[^{}\\n]*\\})?\\s*$`);

/** 분류 기준 `[개념:정의]`의 안쪽 글에서 칸 이름을 뽑는다. 예: "개념:정의" → ["개념", "정의"] */
export const parseCriterionLabels = (criterion: string | null | undefined): string[] => {
  if (!criterion) return [];
  const cuts = topLevelCuts(criterion, ':;<');
  const bounds = [-1, ...cuts, criterion.length];
  return bounds.slice(1).map((end, index) => criterion.slice(bounds[index] + 1, end).trim());
};

/** 분류 기준 글을 칸 이름과 칸 사이 화살표로. `:`는 양방향, `;`는 한 방향이다. */
export const parseCriterionRelation = (criterion: string | null | undefined): { labels: string[]; arrows: DiagramArrow[] } => {
  const labels = parseCriterionLabels(criterion);
  const cuts = criterion ? topLevelCuts(criterion, ':;<') : [];
  return { labels, arrows: cuts.slice(0, Math.max(0, labels.length - 1)).map(cut => arrowOf(criterion![cut])) };
};

const isRelationGlue = (character: string | undefined) => character !== undefined && (isNoteShorthandOn() ? ':;<,=/' : ':;<,/').includes(character);

/**
 * 토글 제목에서 분류 기준 `[ ]`을 뽑는다. 제목 맨 앞이나 글 사이에 따로 쓴 `[개념:정의]`(칸이 둘 이상)만 기준이다.
 * `수열의 합;[등차수열:...],[등비수열:...]`처럼 관계 기호(: ; , = /)에 붙어 있는 대괄호는 예전에 묶음으로 쓴 것이라 기준이 아니고 그대로 둔다(묶음은 이제 `( )`).
 * head는 기준을 뺀 제목이다.
 */
export const titleCriterionRanges = (title: string): Array<{ start: number; end: number; inner: string }> => {
  const ranges: Array<{ start: number; end: number; inner: string }> = [];
  // 텍스트 없이 위치 집합어만 연결어로 이은 제목(`[수]:[성질]`)은 `[수:성질]`의 다른 표기다: 칸마다 위치가 있고 데이터는 없으니 분류기준이지 관계 줄이 아니다.
  const chain = bracketChainOf(title);
  if (chain) return [chain];
  let depth = 0;
  let start = -1;
  for (let index = 0; index < title.length; index += 1) {
    const character = title[index];
    if (character === '[') { if (depth === 0) start = index; depth += 1; continue; }
    if (character !== ']' || depth === 0) continue;
    depth -= 1;
    if (depth > 0) continue;
    const inner = title.slice(start + 1, index).trim();
    const before = title.slice(0, start).trimEnd().slice(-1) || undefined;
    const after = title.slice(index + 1).trimStart()[0];
    if (parseCriterionLabels(inner).filter(Boolean).length < 2 || isRelationGlue(before) || isRelationGlue(after)) continue;
    // `[[수]:[성질]]`의 안쪽 `[수]`는 칸 하나의 위치 집합어라 이름은 `수:성질`이다
    ranges.push({ start, end: index, inner: canonicalMark(inner) });
  }
  return ranges;
};

/** 제목 전체가 `[수]:[성질]`처럼 `[ ]` 칸만 연결어(`: ; <`)로 이은 꼴이면 그 전체를 분류기준 하나(`수:성질`)로 돌려준다. */
const bracketChainOf = (title: string): { start: number; end: number; inner: string } | null => {
  const trimmed = title.trim();
  const cuts = topLevelCuts(trimmed, ':;<');
  if (!cuts.length) return null;
  const bounds = [-1, ...cuts, trimmed.length];
  const parts = bounds.slice(1).map((end, index) => trimmed.slice(bounds[index] + 1, end).trim());
  const isBracketCell = (part: string) => { const end = matchingBracket(part, 0); return end > 0 && end === part.length - 1 && !!part.slice(1, -1).trim(); };
  if (!parts.every(isBracketCell)) return null;
  const start = title.indexOf(trimmed);
  return { start, end: start + trimmed.length - 1, inner: canonicalMark(trimmed) };
};

export const splitTitleCriteria = (title: string): { head: string; criteria: string[] } => {
  const ranges = titleCriterionRanges(title);
  let head = '';
  let copied = 0;
  ranges.forEach(range => { head += title.slice(copied, range.start); copied = range.end + 1; });
  head += title.slice(copied);
  return { head: ranges.length ? head.replace(/\s{2,}/g, ' ').trim() : title, criteria: ranges.map(range => range.inner) };
};

/** 제목에서 분류 기준 `[개념:정의]`가 있던 자리를 같은 길이의 빈칸으로 바꾼다(글자 위치는 그대로라 문제 만들기가 기준을 글로 읽지 않는다). */
export const blankTitleCriteria = (title: string): string => {
  const ranges = titleCriterionRanges(title);
  if (!ranges.length) return title;
  let result = title;
  ranges.forEach(range => { result = result.slice(0, range.start) + ' '.repeat(range.end - range.start + 1) + result.slice(range.end + 1); });
  return result;
};

const DEFINE_MEMBERS_COLON = /^\s*:\s*\(([^()\n]*)\)$/;

/** 분류 기준 `[개념:정의]`처럼 칸이 둘 이상인 대괄호 글인가(집합식이 아니다) */
export const looksLikeCriterion = (inner: string) => topLevelCuts(inner, ':;<').length > 0;

export type NoteSetLine =
  | { kind: 'ability'; expression: string; criterion: string }
  | { kind: 'set'; expression: string }
  | { kind: 'criterion'; criterion: string }
  /** `[A:C]:(D,급수)`: 위치 표시 `[A:C]` 아래에 있는 단어 셀들을 직접 정의한다 */
  | { kind: 'define'; mark: string; members: string[] };

/** 한 칸(줄 또는 `//`로 나눈 칸)이 집합 줄인가: 능력 정의, `[X]` 홀로, 노트 전체 분류 기준 `[개념:정의]` */
export const readNoteSetLine = (segment: string): NoteSetLine | null => {
  const text = segment.trim();
  // 안쪽에 `[ ]`가 겹쳐도(`[급수.[A:C]]`) 짝이 맞는 대괄호로 읽는다
  const firstEnd = matchingBracket(text, 0);
  if (firstEnd > 0) {
    const first = text.slice(1, firstEnd);
    const after = text.slice(firstEnd + 1);
    const colon = /^\s*:\s*/.exec(after);
    if (colon && !looksLikeCriterion(first)) {
      const secondStart = firstEnd + 1 + colon[0].length;
      const secondEnd = matchingBracket(text, secondStart);
      if (secondEnd === text.length - 1 && text.slice(secondStart + 1, secondEnd).trim()) {
        return { kind: 'ability', expression: first.trim(), criterion: text.slice(secondStart + 1, secondEnd).trim() };
      }
    }
    const defined = DEFINE_MEMBERS_COLON.exec(after);
    if (defined && first.trim()) {
      const members = parseMemberList(defined[1]);
      if (members.length) return { kind: 'define', mark: first.trim(), members };
    }
    if (firstEnd === text.length - 1 && first.trim()) {
      return looksLikeCriterion(first) ? { kind: 'criterion', criterion: first.trim() } : { kind: 'set', expression: first.trim() };
    }
  }
  // `급수.[A:C]`·`[A:C].급수`처럼 `[ ]` 밖에 집합 기호를 쓴 줄은 집합 줄이 아니다(집합 기호는 `[ ]` 안에서만: `[급수.[A:C]]`)
  return null;
};

/** 노트 전체에 쓴 분류 기준: 토글 밖(최상위)에 `[개념:정의]`만 쓴 첫 줄 */
export const noteCriterionOf = (memo: string): string | null => {
  for (const block of parseReviewMemoBlocks(memo || '')) {
    if (block.type !== 'text') continue;
    for (const line of block.text.split('\n')) {
      const cuts = topLevelCuts(line, '/').filter(cut => isReviewSlash(line, cut));
      const bounds = [-1, ...cuts, line.length];
      for (let index = 0; index < bounds.length - 1; index += 1) {
        const parsed = readNoteSetLine(line.slice(bounds[index] + 1, bounds[index + 1]));
        if (parsed?.kind === 'criterion') return parsed.criterion;
      }
    }
  }
  return null;
};

/** 묶음이 기준을 바꿨는가: 이어받은 칸 이름에서 제목의 `[ ]`(마지막 것)와 `{이름}`을 반영한 칸 이름. 바뀐 게 없으면 undefined. */
const readGroupLabels = (cleanTitle: string, criteria: string[], inherited: string[]): string[] | undefined => {
  // 바탕이 되는 기준이 없으면 칸 이름만 바꾼 `{이름}`은 보여 줄 것이 없다
  if (!criteria.length && inherited.length === 0) return undefined;
  let labels = criteria.length ? parseCriterionLabels(criteria[criteria.length - 1]) : [...inherited];
  getReviewFieldOverrides(cleanTitle).forEach((label, field) => { labels = Object.assign([...labels], { [field]: label }); });
  labels = Array.from(labels, label => label ?? '');
  return labels.join('\u0000') === inherited.join('\u0000') ? undefined : labels;
};

/** 줄 맨 앞의 `[ ]` 위치 표시 하나. 안쪽에 `[ ]`가 또 있어도(`[급수.[A:C]]`) 짝이 맞는 바깥 것 하나를 뗀다. */
const takeLeadingMark = (text: string): { mark: string; rest: string } | null => {
  const trimmed = text.trim();
  if (trimmed[0] !== '[') return null;
  let depth = 0;
  for (let index = 0; index < trimmed.length; index += 1) {
    if (trimmed[index] === '[') depth += 1;
    else if (trimmed[index] === ']') {
      depth -= 1;
      if (depth > 0) continue;
      const mark = trimmed.slice(1, index).trim();
      // `[A:C] B`처럼 셀 글이 뒤따를 때만 위치 표시다. `[a:b]:c`처럼 관계 기호가 바로 이어지면 그 칸 자체라서 뗄 게 없다.
      // `[ ]` 밖의 점은 집합 기호가 아니라 셀 글자다(`[A:C].B`의 셀은 `.B`).
      const rest = trimmed.slice(index + 1).replace(/^\s*/, '');
      if (!mark || !rest || (isNoteShorthandOn() ? /^[,:;<=/]/ : /^[,:;</]/).test(rest) || /^\(\s*\)$/.test(rest)) return null;
      return { mark, rest };
    }
  }
  return null;
};

/**
 * 위치 표시의 표준형. `[a:b:c]`는 `[[a]:[b]:[c]]`를 줄인 것이라 같은 위치다:
 * 이름 하나뿐인 `[ ]`로 감싼 칸(`[a]`)은 `a`로 풀어서 `[a]:[b]:[c]` · `a:b:c` · `[a]:b:[c]`를 모두 `a:b:c`로 모은다.
 * 집합식이 든 `[ ]`(`[급수.[A:C]]`)는 그대로 둔다.
 */
export const canonicalMark = (text: string): string => {
  const trimmed = text.trim();
  const cuts = topLevelCuts(trimmed, ':;<');
  const bounds = [-1, ...cuts, trimmed.length];
  const unwrap = (part: string) => {
    const end = matchingBracket(part, 0);
    return end > 0 && end === part.length - 1 && part.slice(1, -1).trim() && !/[\[\]().,%]/.test(part.slice(1, -1)) ? part.slice(1, -1).trim() : part;
  };
  return bounds.slice(1).reduce((result, end, index) => {
    const part = unwrap(trimmed.slice(bounds[index] + 1, end).trim());
    return index === 0 ? part : `${result}${trimmed[cuts[index - 1]]}${part}`;
  }, '');
};

const markKey = (text: string) => canonicalMark(text).replace(/\s+/g, '');

/**
 * `[A:C] B`, `[A:C] O:P`처럼 셀 앞에 `[ ]` 위치 표시를 쓴 줄은 토글 `>A:C` 아래에 그 줄을 쓴 것과 같다:
 * 같은 위치 표시를 쓴 줄들을 한 묶음으로 모아 그 안에 넣는다(같은 이름의 토글 묶음이 있으면 그 안으로).
 * 위치 표시가 둘 이상이면 앞의 것부터 바깥 묶음이 된다.
 */
/**
 * 집합 `[ ]`를 쓰지 않은 칸은 그 칸 번호의 분류기준 이름을 칸 앞에 붙여 풀어 쓴 꼴로 바꾼다(`[A] k : j` = `[A] k : [정의] j`).
 * 칸 앞에 `[A]`를 직접 쓴 칸은 그 칸의 분류기준을 새로 쓴 것이라 위쪽 기준을 붙이지 않는다(27일 요청: 예전에는 `[개념][A] k`로 교집합이었다).
 * 줄에 집합 `[A]`로 시작하는 칸이 없으면(위치 표시 `[A:C]`만 있는 줄 포함) 그대로 둔다.
 */
const spellOutDots = (item: DiagramItem, labels: string[], chain: string[][]): DiagramItem => {
  if (item.kind !== 'relation') return item;
  const namesAt = (index: number): string[] => {
    const own = (labels[index] ?? '').trim();
    const stacked = chain.map(row => (row[index] ?? '').trim()).filter(Boolean);
    if (stacked.length && stacked[stacked.length - 1] === own) return stacked;
    return own ? [own] : [];
  };
  const setLed = (field: string) => {
    const text = field.trim();
    const end = text.startsWith('[') ? matchingBracket(text, 0) : -1;
    return end > 0 && !looksLikeCriterion(text.slice(1, end)) && !!text.slice(end + 1).trim();
  };
  if (!item.fields.some((field, index) => namesAt(index).length > 0 && setLed(field))) return item;
  return { ...item, fields: item.fields.map((field, index) => {
    const names = namesAt(index);
    const text = field.trim();
    // 칸 앞에 `[V]`를 직접 쓴 칸은 분류기준을 새로 쓴 것이라 위쪽 기준과 겹치지 않는다(27일 요청)
    if (!names.length || !text || setLed(field)) return field;
    const prefix = names.map(name => `[${name}]`).join('');
    return text.startsWith('[') ? `${prefix}${text}` : `${prefix} ${text}`;
  }) };
};

const placeByMarks = (written: DiagramItem[], inherited: string[]): DiagramItem[] => {
  const items = written;
  type Group = Extract<DiagramItem, { kind: 'group' }>;
  const groups = new Map<string, Group>();
  items.forEach(item => { if (item.kind === 'group' && !groups.has(markKey(item.title))) groups.set(markKey(item.title), item); });
  const touched = new Set<Group>();
  const result: DiagramItem[] = [];
  items.forEach(item => {
    const taken = item.kind === 'plain' ? takeLeadingMark(item.text)
      : item.kind === 'relation' ? takeLeadingMark(item.fields[0]) : null;
    if (!taken) { result.push(item); return; }
    const inside: DiagramItem = item.kind === 'plain' ? { kind: 'plain', text: taken.rest }
      : { ...(item as { kind: 'relation' } & DiagramRelation), fields: [taken.rest, ...(item as { kind: 'relation' } & DiagramRelation).fields.slice(1)] };
    const key = markKey(taken.mark);
    let group = groups.get(key);
    if (!group) {
      const header = parseRelation(taken.mark);
      const viewpoints = header ? header.fields.map((_, index) => inherited[index] ?? '') : [];
      group = header
        ? { kind: 'group', relation: 'containment', title: taken.mark, header, items: [], ...(viewpoints.some(Boolean) ? { fieldLabels: viewpoints } : {}) }
        : { kind: 'group', relation: 'hierarchy', title: taken.mark, items: [] };
      groups.set(key, group);
      result.push(group);
    }
    group.items.push(inside);
    touched.add(group);
  });
  touched.forEach(group => { group.items = placeByMarks(group.items, inherited); });
  return result;
};

const walkDiagram = (memo: string, inherited: string[], chain: string[][], expansions?: DiagramExpansions): DiagramItem[] => placeByMarks(walkBlocks(memo, inherited, chain, expansions), inherited);

const walkBlocks = (memo: string, inherited: string[], chain: string[][], expansions?: DiagramExpansions): DiagramItem[] => parseReviewMemoBlocks(memo || '').flatMap((block): DiagramItem[] => {
  if (block.type === 'text') return block.text.split('\n').flatMap(line => parseLine(line, expansions)).map(item => spellOutDots(item, inherited, chain));
  const { head: cleanTitle, criteria } = splitTitleCriteria(block.title);
  // 제목 끝: 연결어는 아래 줄이 행 단위로 이어지는 "또는"이 기본이고, 맨 끝에 논리관계어를 더하면 그 논리다(`,` 그리고 · `-` 순서 · `=` 같음)
  const open = openTailOf(cleanTitle);
  const tail = open?.connector ? toggleTail().exec(blankOpenLogic(cleanTitle)) : null;
  const head = (tail ? cleanTitle.slice(0, tail.index) : open?.logic ? cleanTitle.slice(0, open.start) : cleanTitle).trim();
  const labels = readGroupLabels(cleanTitle, criteria, inherited);
  const extra = { ...(criteria.length ? { criteria } : {}), ...(labels ? { labels } : {}) };
  // 토글에 분류기준을 새로 쓰면 그것만 쓴다(위쪽 기준 아래로 쌓지 않는다: `[A]:[B]` 아래 `[P]:[q]`는 `[P:q]`)
  const children = walkDiagram(block.text, labels ?? inherited, criteria.length ? [parseCriterionLabels(criteria[criteria.length - 1])] : chain, expansions);
  const headRelation = parseRelation(head);
  if (headRelation) {
    // `>A:C` 처럼 제목 자체가 관계이면, 그 아래에 B:D 같은 관계가 포함된다.
    const viewpoints = headRelation.fields.map((_, index) => (labels ?? inherited)[index] ?? '');
    return [{ kind: 'group', relation: 'containment', title: head, header: headRelation, items: children,
      ...(viewpoints.some(Boolean) ? { fieldLabels: viewpoints } : {}), ...extra }];
  }
  if (!tail) return [{ kind: 'group', relation: 'hierarchy', title: head, items: children, ...extra }];
  const arrow: DiagramArrow = arrowOf(tail[1]);
  const operator: DiagramOperator = open?.logic === ',' ? 'and' : open?.logic === '-' ? 'sequence' : open?.logic === '=' ? 'equal' : 'or';
  const lines = children.flatMap(child => (child.kind === 'plain' ? [child.text] : []));
  if (head && children.length > 0 && lines.length === children.length) {
    return [{ kind: 'fan', left: head, arrow, right: lines, operator, ...extra }];
  }
  return [{ kind: 'group', relation: 'hierarchy', title: head, connector: operator, items: children, ...extra }];
});

/** 노트 글을 관계도로. criterion은 세션 노트의 분류 기준(맨 앞 기준)이고, 토글 제목의 `[ ]`가 그 안에서 기준을 바꾼다. */
export const parseNoteDiagram = (written: string, criterion?: string | null, expansions?: DiagramExpansions): DiagramItem[] => {
  // 맨 끝이 덜 끝난 줄은 바로 밑 줄을 토글 아래 줄처럼 품는다(가장 먼저 처리)
  const memo = expandOpenLines(normalizeNotePunctuation(written));
  const top = parseCriterionLabels(criterion || noteCriterionOf(memo));
  return walkDiagram(memo, top, top.length ? [top] : [], expansions);
};

/** 한 화면 안에서 가장 긴 관계의 칸 수 (표시 칸 너비를 맞추기 위해 사용) */
export const maxDiagramFields = (items: DiagramItem[]): number => items.reduce((max, item) => {
  if (item.kind === 'relation') return Math.max(max, item.fields.length);
  if (item.kind === 'fan') return Math.max(max, 2);
  if (item.kind === 'group') return Math.max(max, item.header ? item.header.fields.length : 2, maxDiagramFields(item.items));
  if (item.kind === 'expanded') return Math.max(max, maxDiagramFields(item.lines));
  return max;
}, 2);

export type DiagramLogicOperator = 'and' | 'or' | 'sequence' | 'equal';

/**
 * 칸 안에 쓴 논리어를 읽는다(화면에서 그리고/또는/다음을 구별해 보이려고). 문제 만들기와 같은 우선순위:
 * 묶음 `( )`(예전에 쓴 `[ ]`도 같다)가 먼저, 그다음 같음 `=`, 순서 `-`, 그리고 `,` 순으로 느슨하다(`=`가 가장 단단히 묶는다). 따옴표 `'…'` 안의 `:`는 `=`, `;`는 `-`, `<`는 거꾸로 가는 `-`다.
 */
export type LogicNode =
  | { kind: 'text'; text: string }
  | { kind: 'group'; inner: LogicNode }
  | { kind: 'op'; operator: DiagramLogicOperator; items: LogicNode[] };

const matchPairs = (text: string): Map<number, number> => {
  const ends = new Map<number, number>();
  const stack: Array<{ open: string; index: number }> = [];
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '[' || character === '(') stack.push({ open: character, index });
    else if (character === ']' || character === ')') {
      const open = character === ']' ? '[' : '(';
      const at = stack.map(item => item.open).lastIndexOf(open);
      if (at >= 0) { ends.set(stack[at].index, index); stack.length = at; }
    }
  }
  return ends;
};

export const parseLogicText = (text: string): LogicNode => {
  const ends = matchPairs(text);
  const { marks: quoted, edges, literal } = reviewQuotes(text);
  const LEVELS = [[',', 'and'], ['-', 'sequence'], ['=', 'equal']] as const;
  const read = (from: number, to: number, level: number): LogicNode => {
    for (let changed = true; changed;) {
      changed = false;
      while (from < to && /\s/.test(text[from])) from += 1;
      while (to > from && /\s/.test(text[to - 1])) to -= 1;
      // 칸 가장자리의 따옴표 글자 `'`는 묶음을 나타내는 표시라 글이 아니다.
      if (from < to && edges.has(from)) { from += 1; changed = true; }
      if (to > from && edges.has(to - 1)) { to -= 1; changed = true; }
    }
    if (level >= LEVELS.length) {
      if ((text[from] === '[' || text[from] === '(') && ends.get(from) === to - 1) {
        const inner = read(from + 1, to - 1, 0);
        if (inner.kind !== 'text') return { kind: 'group', inner };
      }
      const shown = edges.size ? Array.from({ length: Math.max(0, to - from) }, (_, offset) => from + offset).filter(at => !edges.has(at)).map(at => text[at]).join('') : text.slice(from, to);
      return { kind: 'text', text: shown };
    }
    const [symbol, operator] = LEVELS[level];
    if (symbol === '=' && !isNoteShorthandOn()) return read(from, to, level + 1);
    const cuts: number[] = [];
    for (let index = from; index < to; index += 1) {
      const role = quoted.get(index);
      if (role) { if (quotedMarkCuts(role, symbol)) cuts.push(index); continue; }
      // 따옴표 안의 `,` `-` `=`는 글자다(문제 만들기와 같은 규칙): `'v = Δx/Δt'`는 수식 한 칸
      if (literal.has(index)) continue;
      const close = ends.get(index);
      if (close !== undefined && close < to) { index = close; continue; }
      if (text[index] !== symbol) continue;
      if (symbol === '-' && !isReviewSequenceSeparator(text, index, from, to)) continue;
      cuts.push(index);
    }
    const bounds = [from - 1, ...cuts, to];
    const parts = bounds.slice(1).map((end, i) => ({ range: [bounds[i] + 1, end] as const, backward: operator === 'sequence' && i > 0 && text[cuts[i - 1]] === '<' }))
      .filter(({ range: [a, b] }) => text.slice(a, b).trim());
    if (parts.length < 2) return read(from, to, level + 1);
    // 따옴표 안의 `<`는 거꾸로 가는 순서라서, 그것으로 이어진 항목들은 쓴 글의 반대 순서로 놓는다(`b < a` = `a → b`).
    const blocks: Array<typeof parts[number]['range'][]> = [];
    parts.forEach(part => (part.backward && blocks.length ? blocks[blocks.length - 1].unshift(part.range) : blocks.push([part.range])));
    return { kind: 'op', operator, items: blocks.flat().map(([a, b]) => read(a, b, level + 1)) };
  };
  return read(0, text.length, 0);
};
