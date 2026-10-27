/**
 * 줄글 문제: 구조(`A AND B`, `p → q`, `x = y`)로 낸 문제 글을 실제 문제집처럼 문장으로 바꾼다.
 * 값은 따옴표로 묶고, 조사(이/가 · 은/는 · 을/를 · 와/과)가 값에 따라 달라지지 않도록
 * 조사가 필요 없는 말(에 · 에서 · 외에 · 모두 · 순서대로 …)로만 잇는다.
 * 논리어는 글로 풀어 쓴다: AND → `a, b … 모두`, OR → `또는`, 순서는 `a → b`와 `순서대로`.
 */
import { attributeTag, blankMark, readableLabel } from './questionStatement';

export { attributeTag, readableLabel };

export type LabelOperator = 'and' | 'or' | 'sequence' | 'equal' | 'single';

/** 괄호 밖(깊이 0)에서만 `delimiter`로 자른다 */
export const splitLabel = (label: string, delimiter: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < label.length; index += 1) {
    const character = label[index];
    if (character === '(') depth += 1;
    else if (character === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0 && label.startsWith(delimiter, index)) {
      parts.push(label.slice(start, index));
      index += delimiter.length - 1;
      start = index + 1;
    }
  }
  parts.push(label.slice(start));
  return parts;
};

/** 글의 가장 바깥 논리어 */
export const operatorOf = (label: string): LabelOperator => {
  if (splitLabel(label, ' OR ').length > 1) return 'or';
  if (splitLabel(label, ' AND ').length > 1) return 'and';
  if (splitLabel(label, ' → ').length > 1) return 'sequence';
  if (splitLabel(label, ' = ').length > 1) return 'equal';
  return 'single';
};

const quote = (text: string) => `‘${text}’`;
const NUMBERS = ['', '한', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉', '열'];
export const count = (steps: number) => `${NUMBERS[steps] || steps} 걸음`;

export interface ProseInput {
  kind: string;
  prompt: string;
  answer: string;
  conditions: string[];
  direction: 'forward' | 'reverse';
  distance?: number;
  /** 한 칸 안의 `=`로 이은 이웃 쌍 */
  form?: 'equal';
}
export interface Prose { statement: string; solution?: string }

/** 풀이 글에 쓸 정답: 논리어가 들어 있을 때만 풀어 쓴 글을 따로 준다 */
const solutionOf = (answer: string): string | undefined => {
  const text = readableLabel(answer);
  return text === answer ? undefined : text;
};

/** 조건 중 "충족"이 붙은 것은 이미 만족한 것이고, 나머지는 문제가 놓인 자리(위쪽 토글 · 줄 앞 집합)다 */
export const SATISFIED = / 충족$/;
/** `p 이후`: 순서에서 p 다음 자리에 놓인 값이다 */
export const AFTER = / 이후$/;
/** `A:(B:C)`의 A처럼 괄호 칸의 주인: "‘A’의 ‘B’에 이어지는 것은?"으로 읽는다(27일 요청). 조건 글 끝에 붙는 표시다. */
export const OWNER_MARK = ' 의';
export const OWNER = / 의$/;

/**
 * 줄글 안에서 값의 속성(세션 노트의 분류기준 `개념:정의:예시`)이 드러나게 하는 이름들. 이름이 있으면 값 앞에 붙는다:
 * `개념 ‘A’에서 정의 ‘p’에 이어지는 예시 값은?` — 맞힐 값은 "것" 대신 속성 이름(`예시 값`)으로 묻는다.
 * `conditions`는 문제의 `conditions`와 같은 순서다.
 */
export interface ProseAttrs { prompt: string[]; answer: string[]; conditions: string[][] }

/**
 * 자리(위쪽 토글 이름)가 정답과 같은 글이면 문제에 정답이 그대로 보이므로 자리에서 뺀다.
 * 예: 토글 `태조` 안의 `태조=이성계` → "‘태조’에서 ‘이성계’에 대응하는 것은?"(정답 태조) 대신 "‘이성계’에 대응하는 것은?"
 */
export const withoutAnswerPlace = (conditions: readonly string[], answer?: string) => {
  const hidden = answer === undefined ? '' : readableLabel(answer).trim();
  return conditions.map((text, index) => ({ text, index }))
    .filter(item => !hidden || SATISFIED.test(item.text) || readableLabel(item.text.replace(AFTER, '').replace(OWNER, '')).trim() !== hidden);
};

/** 문제가 놓인 자리: `개념 ‘A’에서 ` · `‘p’ 다음 자리의 `. 속성 이름(labels)이 있으면 값 앞에 붙는다. "충족"이 붙은 조건은 여기 넣지 않는다. */
export const placeOf = (conditions: readonly string[], labels?: readonly (readonly string[])[], answer?: string): string => {
  const entries = withoutAnswerPlace(conditions, answer);
  const afters = entries.filter(item => AFTER.test(item.text));
  const owners = entries.filter(item => OWNER.test(item.text));
  const place = entries.filter(item => !SATISFIED.test(item.text) && !AFTER.test(item.text) && !OWNER.test(item.text));
  return `${place.length ? `${place.map(item => attributeTag(readableLabel(item.text), labels?.[item.index])).join(', ')}에서 ` : ''}${owners.length
    ? `${owners.map(item => attributeTag(readableLabel(item.text.replace(OWNER, '')), labels?.[item.index])).join(', ')}의 ` : ''}${afters.length
    ? `${afters.map(item => attributeTag(readableLabel(item.text.replace(AFTER, '')), labels?.[item.index])).join(', ')} 다음 자리의 ` : ''}`;
};

/** 문제 한 개의 줄글. 줄글로 바꾸지 않는 종류(노트 회상 · 능력 변환)는 null. attrs가 있으면 값마다 속성 이름을 붙인다. */
export const proseOf = (input: ProseInput, attrs?: ProseAttrs): Prose | null => {
  const { kind, prompt, answer, conditions, direction } = input;
  if (kind === 'recall' || kind === 'convert') return null;
  const labelsOf = (index: number) => attrs?.conditions[index];
  const entries = conditions.map((text, index) => ({ text, index }));
  const satisfied = entries.filter(item => SATISFIED.test(item.text));
  const where = placeOf(conditions, attrs?.conditions, answer);
  // 이미 충족한 값들은 한 묶음으로: 속성 이름은 겹치지 않게 모은다
  const doneLabels = [...new Set(satisfied.flatMap(item => labelsOf(item.index) ?? []))];
  const done = satisfied.length ? `${attributeTag(satisfied.map(item => readableLabel(item.text.replace(SATISFIED, ''))).join(', '), doneLabels)} 외에 ` : '';
  const given = readableLabel(prompt);
  const givenTag = attributeTag(given, attrs?.prompt);
  const givenOperator = operatorOf(prompt);
  const answerOperator = operatorOf(answer);
  const solution = solutionOf(answer);
  const noun = attrs?.answer.length ? `${attrs.answer.join('·')} 값` : '것';

  if (kind === 'blank') {
    // 줄 안의 칸을 가린 문제(`＿ → B → C`): 가린 자리를 ㉠ ㉡ …로 바꾸고, `…`는 묻지 않는 부분이다
    let order = 0;
    const shown = readableLabel(prompt).replace(/＿/g, () => `( ${blankMark(order++)} )`);
    const marks = Array.from({ length: Math.max(1, order) }, (_, index) => blankMark(index)).join(', ');
    const hidden = splitLabel(answer, ' → ').map(readableLabel);
    const tail = order <= 1 ? `${marks}에 알맞은 ${noun}은?` : `${marks}에 알맞은 ${noun}을 차례로 쓰시오.`;
    return { statement: `${where}${quote(shown)}에서 ${tail}${prompt.includes('…') ? ' (…는 생략)' : ''}`,
      solution: order > 1 && hidden.length === order ? hidden.map((item, index) => `${blankMark(index)} ${item}`).join('   ') : undefined };
  }
  if ((kind === 'direct' || kind === 'reverse') && input.form === 'equal') return { statement: `${where}${givenTag}에 대응하는 ${noun}은?`, solution };
  if (kind === 'direct') {
    const lead = `${where}${givenTag}에 이어지는 ${noun}`;
    return { statement: answerOperator === 'and' ? `${lead}을 모두 쓰시오.` : answerOperator === 'sequence' ? `${lead}을 순서대로 쓰시오.`
      : answerOperator === 'or' ? `${lead} 중 하나를 쓰시오.` : `${lead}은?`, solution };
  }
  if (kind === 'reverse') {
    const lead = givenOperator === 'and' ? `${where}${givenTag} 모두에 앞서 이어진 ${noun}`
      : givenOperator === 'sequence' ? `${where}${givenTag} 순서에 앞서 이어진 ${noun}` : `${where}${givenTag}에 앞서 이어진 ${noun}`;
    return { statement: answerOperator === 'or' ? `${lead} 중 하나를 쓰시오.` : `${lead}은?`, solution };
  }
  if (kind === 'remaining') {
    const lead = `${where}${givenTag}에 필요한 것 중 ${done}남은 ${noun}`;
    return { statement: answerOperator === 'and' ? `${lead}을 모두 쓰시오.` : answerOperator === 'sequence' ? `${lead}을 순서대로 쓰시오.` : `${lead}은?`, solution };
  }
  if (kind === 'reconstruct') {
    return { statement: `${where}${givenTag}에서 이어지는 ${noun}을 끝까지 순서대로 쓰시오.`, solution };
  }
  if (kind === 'far') {
    const steps = input.distance && input.distance >= 2 ? count(input.distance) : '몇 걸음';
    return { statement: `${where}${givenTag}부터 ${steps} ${direction === 'reverse' ? '앞에' : '뒤에'} 이어지는 ${noun}은?`, solution };
  }
  if (kind === 'order-next') return { statement: `${where}${givenTag} 바로 다음에 오는 ${noun}은?`, solution };
  if (kind === 'order-previous') return { statement: `${where}${givenTag} 바로 앞에 오는 ${noun}은?`, solution };
  if (kind === 'order-reconstruct') return { statement: `${where}${givenTag} 다음에 오는 ${noun}을 순서대로 쓰시오.`, solution };
  return null;
};

/**
 * 능력 변환 카드의 문장. 주어진 값(들)은 문장 안에 쓰고, 맞힐 칸은 카드의 정답 칸에 둔다.
 * 건너뛴 칸은 문장에도 쓰지 않는다(능력 정의가 건너뜀을 허용하면 스스로 이끌어 낼 수 있다).
 * 칸 안을 가린 변주(`＿-정리-확인`)는 가린 자리를 ㉠ ㉡ …로 바꿔 문장에 넣는다.
 */
export interface ConvertProseInput {
  steps: Array<{ set: string; cell: string }>;
  given?: number[];
  required: number[];
  partial?: Record<number, string>;
  /** 단위 문제가 걷는 방향(연결어가 정한 칸 순서). 같은 집합끼리의 변환은 집합 이름만으로 방향이 안 드러나 문장에 앞/뒤를 넣는다. */
  direction?: 'forward' | 'reverse';
}
/** 능력 변환 카드의 속성 이름: 주어진 값들 · 맞힐 값들이 세션 노트 분류기준에서 어떤 속성인지 */
export interface ConvertAttrs { given: string[]; required: string[] }
export const convertStatement = (convert: ConvertProseInput, attrs?: ConvertAttrs): string => {
  const given = convert.given ?? [0];
  const givenKind = attrs?.given.length ? `${attrs.given.join('·')} ` : '';
  const noun = attrs?.required.length ? `${attrs.required.join('·')} 값` : '값';
  const refs = given.map(index => `집합 ${quote(convert.steps[index].set)}의 ${givenKind}${quote(convert.steps[index].cell)}`).join(', ');
  const sets = convert.required.map(index => quote(convert.steps[index].set)).join(', ');
  const first = convert.required[0];
  const partial = convert.partial?.[first];
  if (partial !== undefined) {
    let order = 0;
    const shown = partial.replace(/＿/g, () => `( ${blankMark(order++)} )`);
    const marks = Array.from({ length: Math.max(1, order) }, (_, index) => blankMark(index)).join(', ');
    const what = attrs?.required.length ? `${attrs.required.join('·')} 값` : '것';
    const tail = order <= 1 ? `${marks}에 알맞은 ${what}은?` : `${marks}에 알맞은 ${what}을 ${partial.includes(', ') ? '쓰시오. (순서는 상관없다)' : '차례로 쓰시오.'}`;
    return `${refs}에 대응하는 집합 ${quote(convert.steps[first].set)}의 ${quote(shown)}에서 ${tail}`;
  }
  if (given.length === 1) {
    // 같은 집합 안의 단위 변환(`[번호] 1 : @+1`)은 "대응"만으로는 앞뒤가 안 드러나, 연결어 방향대로 다음/앞을 쓴다
    const sameSet = convert.direction && convert.required.length === 1 && convert.steps.every(step => step.set === convert.steps[0].set);
    if (sameSet) return `${refs} ${convert.direction === 'reverse' ? '앞에 놓인' : '다음에 이어지는'} 집합 ${sets}의 ${noun}은?`;
    return convert.required.length === 1 ? `${refs}에 대응하는 집합 ${sets}의 ${noun}은?` : `${refs}에서 이어지는 집합 ${sets}의 ${noun}을 차례로 쓰시오.`;
  }
  const lowest = Math.min(...given);
  const highest = Math.max(...given);
  const place = convert.required.every(index => index > highest) ? '다음에 이어지는' : convert.required.every(index => index < lowest) ? '앞에 놓인' : '사이에 놓인';
  return `${refs} ${place} 집합 ${sets}의 ${noun}${convert.required.length === 1 ? '은?' : '을 차례로 쓰시오.'}`;
};
