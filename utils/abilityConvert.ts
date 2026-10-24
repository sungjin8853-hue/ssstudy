import { matchingBracket } from './setExpression';
import type { NoteQuestion } from './reviewQuestions';
import { foldArithmetic } from './arithmeticFold';
import { isNoteShorthandOn } from './noteShorthand';
import { clampCombineLength, COMBINE_LENGTH_DEFAULT, readCombineLength } from './combineLength';

/**
 * 능력 변환 문제: `[a] b ; [c] d`처럼 관계의 모든 칸이 집합 안에 있으면, 두 칸은 서로 변환할 수 있는 값이고
 * 각 값이 만족해야 하는 조건(집합 a, c)이 "능력 집합"이다. 문제는 능력 집합과 변환하려는 값 하나가 주어지고, 변환된 값 하나를 맞히는 것이다.
 *  - 칸의 집합은 칸 앞에 직접 쓴 `[ ]`와, 위쪽 분류기준 · 토글 제목이 관계(`> [A] B: [C] D`)일 때 아래 줄이 이어받는 집합(`A.B` · `C.D`)의 교집합이다.
 *  - 최소 단위: 이웃한 두 칸 하나하나가 문제 하나다(`;` 앞으로만, `<` 거꾸로만, `:`·`=` 양쪽). 일정은 단위마다 따로 쌓는다.
 *  - 결합: `[a] b ; [c] d`와 `[c] d ; [u] e`처럼 한 칸이 이어지면 `[a] b ; [c] d ; [u] e`로 이어 하나의 문제로 낼 수 있다.
 *    복습 간격이 달라져 떨어졌다가 같이 복습할 때가 되면 다시 결합한다(다른 과목의 노트와도 이어진다).
 *  - 자유도: 쉬움을 고르면 그 단위의 출력 값에 자유도가 생겨, 다음 결합에서는 그 값을 건너뛰고(`[a] b ; [u] e`) 묻는다.
 *    건너뛴 칸은 문제에 보여 주지 않는다: 능력 정의가 건너뛸 수 있게 되어 있으면 스스로 이끌어 낼 수 있기 때문이다.
 */

export interface ConvertStep {
  /** 능력 집합: 칸이 속한 집합들의 교집합식(`A.B.p`). 합집합이 섞인 부분은 괄호로 묶는다. */
  set: string;
  cell: string;
}

export type ConvertForm = 'unit' | 'chain' | 'jump';

export interface ConvertInfo {
  /** 문제가 걷는 순서대로 놓인 칸. 첫 칸이 주어진 값이다. */
  steps: ConvertStep[];
  /** 정답으로 꼭 적어야 하는 칸(steps 번호). 자유도로 건너뛴 칸은 들어 있지 않고, 문제에도 보이지 않는다. */
  required: number[];
  /** 이 문제가 덮는 단위 문제들의 key. 일정과 자유도는 이 단위에 붙는다. */
  unitKeys: string[];
  form: ConvertForm;
  /** 주어진 칸(steps 번호). 없으면 첫 칸 하나다. 변주 문제는 한 줄의 여러 칸이 주어진다. */
  given?: number[];
  /**
   * 변주 문제: `row` 한 줄의 칸을 가린 빈칸 · `cell` 논리 덩어리(`B,C` · `읽기-정리-확인`) 한 칸 안을 가린 빈칸·순서·남은 조건.
   * 변주는 단위가 아니라서 결합하지 않고 자유도도 붙지 않는다(일정은 문제마다 따로 쌓는다).
   */
  variation?: 'row' | 'cell';
  /** 변주에서 정답 칸이 가려진 채 보일 글(steps 번호 → 가린 글). 집합(논리어)은 가리지 않는다. */
  partial?: Record<number, string>;
}

/** 가린 자리 */
export const MASK = '＿';

export const isConvertUnitKey = (key: string) => key.startsWith('cv1:');
/** 결합 단위 수의 기본값. 사용자가 2~10으로 바꿀 수 있다(`combineLength`). */
export const MAX_CHAIN_UNITS = COMBINE_LENGTH_DEFAULT;

const norm = (text: string) => text.replace(/\s+/g, '');
export const convertNodeId = (step: ConvertStep) => `${norm(step.set)}|${norm(step.cell)}`;

const hash = (text: string) => {
  let value = 2166136261;
  for (const character of text) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
  return (value >>> 0).toString(36);
};

/** 최상위(괄호·대괄호 바깥)에 `,`(합집합)가 있는가 */
export const hasTopLevelUnion = (text: string) => {
  let depth = 0;
  for (const character of text) {
    if (character === '(' || character === '[') depth += 1;
    else if (character === ')' || character === ']') depth -= 1;
    else if (character === ',' && depth === 0) return true;
  }
  return false;
};

/** 집합들의 교집합식 글: `A`, `B`, `p`를 `A.B.p`로 잇는다. 합집합이 든 것은 괄호로 묶는다(`(a,b).c`). 빈 것과 같은 것은 뺀다. */
export const joinSets = (parts: readonly string[]): string => {
  const kept: string[] = [];
  parts.map(part => part.trim()).filter(Boolean).forEach(part => { if (!kept.some(item => norm(item) === norm(part))) kept.push(part); });
  return kept.map(part => (kept.length > 1 && hasTopLevelUnion(part) ? `(${part})` : part)).join('.');
};

/**
 * 칸 글 맨 앞의 `[ ]`들(집합)과 나머지 값. 값이 없거나 관계 기호로 시작하면 null. 집합이 없으면 sets가 비어 있다.
 * 집합 기호(`.` `,` `%`)는 `[ ]` 안에서만 쓴다: `[개념.A] k`. `[ ]` 밖의 점은 집합 기호가 아니라 값의 글자다(`.[A] k`의 점 줄임도 `[A].[B] k`도 `[A:C].급수`도 없다).
 * 칸의 집합은 언제나 그 칸 번호의 상위 속성(분류기준 · 위쪽 토글 제목의 집합)과 교집합이다(`convertFieldsOf`).
 */
export const readConvertCell = (text: string): { sets: string[]; cell: string } | null => {
  let rest = text.trim();
  const sets: string[] = [];
  for (let end = matchingBracket(rest, 0); end > 0; end = matchingBracket(rest, 0)) {
    const inner = rest.slice(1, end).trim();
    if (inner) sets.push(inner);
    rest = rest.slice(end + 1).replace(/^\s*/, '');
  }
  rest = rest.trim();
  if (!rest || /^\(\s*\)$/.test(rest) || (isNoteShorthandOn() ? /^[,:;<=/]/ : /^[,:;</]/).test(rest)) return null;
  return { sets, cell: rest };
};

/** 칸 글에서 능력 집합과 값을 읽는다: 맨 앞의 `[ ]`들이 집합, 나머지가 값. 집합이 없거나 값이 없으면 null. */
export const readConvertField = (text: string): ConvertStep | null => {
  const read = readConvertCell(text);
  return read && read.sets.length ? { set: joinSets(read.sets), cell: read.cell } : null;
};

/** 자유도 단계: 0 없음 · 1 이상이면 출력 값을 건너뛴다. 자유도가 1 오를 때마다 능력 논리의 연결이 한 칸씩 더 멀리 닿는다(`convertReachOf`). */
export interface ConvertUnitState { freedom: number; reps: number }
export type ConvertMode = 'plain' | 'skip';

/** 능력 논리가 자유도 때문에 더 멀리 닿는 칸 수: 자유도가 1 오를 때마다 1칸(최대 3칸) */
export const MAX_CONVERT_REACH = 3;
export const convertReachOf = (state: ConvertUnitState): number => Math.min(MAX_CONVERT_REACH, Math.max(0, Math.floor(state.freedom || 0)));

/** 단위 하나가 이번에 어떤 모양으로 나올지: 자유도가 없으면 그대로, 있으면 이어질 때 출력 값을 건너뛴다. */
export const convertModeOf = (state: ConvertUnitState): ConvertMode => (Math.floor(state.freedom || 0) >= 1 ? 'skip' : 'plain');

export interface ConvertCandidate { logId: string; question: NoteQuestion; state: ConvertUnitState }
export interface PlannedConvert {
  /** 화면에서 이 문제를 가리키는 key (단위 key와 다르다) */
  key: string;
  question: NoteQuestion;
  covered: { logId: string; questionKey: string }[];
  form: ConvertForm;
}

const unitSteps = (candidate: ConvertCandidate) => candidate.question.convert!.steps;

/** "풀이 과정" 버튼에 보일 글: 칸마다 값과 능력 집합을 이은 길 */
export const processOf = (steps: readonly ConvertStep[]) => steps.map(step => `${step.cell} (${step.set})`).join(' → ');

/**
 * 자유도가 1 이상인 단위의 출력 값은 글 속의 `숫자 기호 숫자`를 계산한 값으로 보인다(19:09 규칙: `3*(sin x)^(3-1)` → `3*(sin x)^2`).
 * 노트 글과 문제 키는 그대로이고 보이는 글만 바뀐다. 자유도가 없으면 쓴 그대로 보여 계산 과정이 힌트가 된다.
 */
export const foldConvertUnit = (question: NoteQuestion, state: ConvertUnitState): NoteQuestion => {
  const convert = question.convert;
  if (!convert || Math.floor(state.freedom || 0) < 1) return question;
  const steps = convert.steps.map((step, index) => (convert.required.includes(index) ? { ...step, cell: foldArithmetic(step.cell) } : step));
  if (steps.every((step, index) => step.cell === convert.steps[index].cell)) return question;
  return { ...question, answer: convert.required.map(index => steps[index].cell).join(' → '), process: processOf(steps), convert: { ...convert, steps } };
};

const composeQuestion = (form: ConvertForm, steps: ConvertStep[], required: number[], covered: ConvertCandidate[]): NoteQuestion => {
  const first = covered[0].question;
  const unitKeys = covered.map(item => item.question.key);
  const key = `cvp:${hash(JSON.stringify([form, unitKeys]))}`;
  // 자유도가 있는 단위가 낸 칸(steps[i]는 covered[i-1]의 출력)은 계산된 값으로 보인다
  steps = steps.map((step, index) => (index > 0 && required.includes(index) && Math.floor(covered[index - 1]?.state.freedom || 0) >= 1 ? { ...step, cell: foldArithmetic(step.cell) } : step));
  return {
    ...first, key, kind: 'convert', prompt: steps[0].cell, answer: required.map(index => steps[index].cell).join(' → '), direction: 'forward',
    // 건너뛴 칸은 문제와 정답 어디에도 드러내지 않고, "풀이 과정" 버튼을 눌렀을 때만 길 전체를 보여 준다
    process: processOf(steps), level: 1,
    priority: Math.min(...covered.map(item => item.question.priority)),
    importance: Math.max(...covered.map(item => item.question.importance)),
    recallUnits: required.length, providedUnits: 1, difficulty: required.length / (required.length + 1),
    conditions: [], conditionSpans: [], answerSpans: [], promptSpans: [],
    columns: { prompt: [], answer: [], conditions: [] },
    convert: { steps, required, unitKeys, form }
  };
};

/**
 * 이번에 복습할 차례가 된 단위 문제들을 결합한다. 단위들이 한 칸으로 이어지면(b→d, d→e) 한 문제로 묶어 `b → d → e`를 묻는다.
 * 자유도가 있는 단위의 출력 값은 건너뛰고(b → e), 건너뛴 칸은 문제에 보여 주지 않는다. 자유도가 1 오를 때마다 한 칸씩 더 건너뛴다(자유도 2면 두 칸).
 * 이 문제가 맡은 단위들은 absorbed에 들어가고, 나머지 단위는 원래 문제 그대로 낸다.
 */
export const planConvertReview = (candidates: ConvertCandidate[], maxUnits: number = readCombineLength()): { planned: PlannedConvert[]; absorbed: Set<string> } => {
  const limit = clampCombineLength(maxUnits);
  const absorbed = new Set<string>();
  const planned: PlannedConvert[] = [];
  const usable = candidates.filter(item => item.question.convert?.form === 'unit' && !item.question.convert.variation && unitSteps(item).length === 2);
  // 한 칸으로 이어지는 단위 길(최대 limit개 · 사용자 설정 2~10, 기본 4). 같은 칸을 두 번 지나지 않는다.
  const startsAt = new Map<string, ConvertCandidate[]>();
  usable.forEach(item => {
    const id = convertNodeId(unitSteps(item)[0]);
    startsAt.set(id, [...(startsAt.get(id) ?? []), item]);
  });
  const paths: ConvertCandidate[][] = [];
  const extend = (path: ConvertCandidate[], visited: Set<string>) => {
    if (path.length >= 2) paths.push(path);
    if (path.length >= limit) return;
    const tail = unitSteps(path[path.length - 1])[1];
    (startsAt.get(convertNodeId(tail)) ?? []).forEach(next => {
      const target = convertNodeId(unitSteps(next)[1]);
      if (visited.has(target) || path.includes(next)) return;
      extend([...path, next], new Set([...visited, target]));
    });
  };
  usable.forEach(item => extend([item], new Set([convertNodeId(unitSteps(item)[0]), convertNodeId(unitSteps(item)[1])])));
  const order = new Map(usable.map((item, index) => [item, index] as const));
  paths.sort((a, b) => b.length - a.length || order.get(a[0])! - order.get(b[0])!);
  const taken = new Set<ConvertCandidate>();
  paths.forEach(path => {
    if (path.some(item => taken.has(item))) return;
    path.forEach(item => taken.add(item));
    const steps = [unitSteps(path[0])[0], ...path.map(item => unitSteps(item)[1])];
    // 단위마다 자유도만큼 자기 출력부터 이어지는 칸을 건너뛴다(마지막 칸은 늘 묻는다)
    const hidden = new Set<number>();
    path.forEach((item, at) => { for (let reach = 1; reach <= convertReachOf(item.state); reach += 1) if (at + reach < steps.length - 1) hidden.add(at + reach); });
    const required = steps.map((_, index) => index).filter(index => index > 0 && !hidden.has(index));
    const form: ConvertForm = required.length < steps.length - 1 ? 'jump' : 'chain';
    const question = composeQuestion(form, steps, required, path);
    // 같은 줄의 변주 `a → ＿ → ＿`(첫 칸만 주고 나머지를 다 묻는 row 변주)는 이 결합 문제와 글자까지 같아 한 복습에 두 번 나오므로 함께 덮는다
    const sameRow = form === 'chain' ? candidates.filter(item => {
      const convert = item.question.convert;
      if (convert?.variation !== 'row' || !path.some(unit => unit.logId === item.logId)) return false;
      const given = convert.given ?? [0];
      return convert.steps.length === steps.length && given.length === 1 && given[0] === 0
        && convert.required.length === steps.length - 1 && convert.steps.every((step, index) => step.cell === steps[index].cell && step.set === steps[index].set);
    }) : [];
    planned.push({ key: question.key, question, covered: [...path, ...sameRow].map(item => ({ logId: item.logId, questionKey: item.question.key })), form });
    [...path, ...sameRow].forEach(item => absorbed.add(`${item.logId}\u0000${item.question.key}`));
  });
  return { planned, absorbed };
};

export const CONVERT_FORM_LABELS: Record<ConvertForm, string> = { unit: '능력 변환', chain: '능력 변환', jump: '능력 변환' };

export const convertLabel = (convert: Pick<ConvertInfo, 'form'>) => CONVERT_FORM_LABELS[convert.form];
