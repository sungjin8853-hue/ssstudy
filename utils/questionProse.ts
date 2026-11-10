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
  form?: 'equal' | 'components' | 'match' | 'together';
  /** 남은 값의 다음 값을 묻는 남은 조건 문제(2일) */
  beyond?: boolean;
  /** 8일: 맞힐 값에 쓴 `{X}`들(중복 없이). 있으면 "X에 해당하는 내용이 들어가도록" 부가조건을 붙인다 */
  answerKeywords?: readonly string[];
  /** 7일: 조건마다 보이는 방법(near · related · hidden). 없으면 모든 조건을 같게 보인다 */
  conditionRoles?: readonly ('near' | 'related' | 'hidden' | undefined)[];
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
/** 예전 "A의 B" 표시(31일에 없앰). 남아 있는 조건 글을 읽을 때만 쓴다 */
export const OWNER = / 의$/;

/** 받침이 있으면 앞, 없으면 뒤 조사(한글이 아닌 글자로 끝나면 둘 다 적는다) */
/** 조사를 고를 글자: 따옴표 · 괄호 · 빈칸은 건너뛴 마지막 글자 */
const lastLetter = (word: string) => word.replace(/[\s‘’'"(){}\[\]]+$/g, '').slice(-1);
const josa = (word: string, withFinal: string, withoutFinal: string) => {
  const last = lastLetter(word);
  const code = last.charCodeAt(0) - 0xac00;
  if (!(code >= 0 && code < 11172)) return `${withFinal}(${withoutFinal})`;
  return code % 28 ? withFinal : withoutFinal;
};
/** 은/는 · 을/를 · 과/와 · 으로/로를 붙인 말 */
export const topic = (word: string) => `${word}${josa(word, '은', '는')}`;
export const object = (word: string) => `${word}${josa(word, '을', '를')}`;
const withAnd = (word: string) => `${word}${josa(word, '과', '와')}`;
const madeOf = (word: string) => {
  const last = lastLetter(word);
  const code = last.charCodeAt(0) - 0xac00;
  // ㄹ 받침 · 받침 없음은 "로", 다른 받침은 "으로"
  return `${word}${code >= 0 && code < 11172 && code % 28 && code % 28 !== 8 ? '으로' : '로'}`;
};

/**
 * 줄글 안에서 값의 속성(세션 노트의 분류기준 `개념:정의:예시`)이 드러나게 하는 이름들. 이름이 있으면 값 앞에 붙는다:
 * `개념 ‘A’에서 정의 ‘p’의 예시는?` — 맞힐 값은 속성 이름(`예시`)으로 묻는다(31일: "이어지는"은 없앴다).
 * `conditions`는 문제의 `conditions`와 같은 순서다.
 */
export interface ProseAttrs { prompt: string[]; answer: string[]; conditions: string[][] }

/**
 * 자리(위쪽 토글 이름)가 정답과 같은 글이면 문제에 정답이 그대로 보이므로 자리에서 뺀다.
 * 예: 토글 `태조` 안의 `태조=이성계` → "‘태조’에서 ‘이성계’에 대응하는 것은?"(정답 태조) 대신 "‘이성계’에 대응하는 것은?"
 */
export const withoutAnswerPlace = (conditions: readonly string[], answer?: string, roles?: ProseInput['conditionRoles']) => {
  const hidden = answer === undefined ? '' : readableLabel(answer).trim();
  return conditions.map((text, index) => ({ text, index, role: roles?.[index] }))
    .filter(item => item.role !== 'hidden')
    .filter(item => !hidden || SATISFIED.test(item.text) || readableLabel(item.text.replace(AFTER, '').replace(OWNER, '')).trim() !== hidden);
};

/** 7일: 가장 가까운 위치 집합(따옴표)과 위치를 가리려고 함께 주는 그 위 집합(`[ ]`, 노트에서 `[동물] 포유류`로 쓰는 꼴)을 나눠 쓴다 */
const splitRelated = <T extends { role?: string }>(items: T[]) => {
  const near = items.filter(item => item.role !== 'related');
  // 가까운 집합이 정답과 같아 빠졌으면 위 집합이 곧 자리다
  return near.length ? { related: items.filter(item => item.role === 'related'), near } : { related: [] as T[], near: items };
};

/** 문제가 놓인 자리: `개념 ‘A’에서 ` · `‘p’ 다음 자리의 `. 속성 이름(labels)이 있으면 값 앞에 붙는다. "충족"이 붙은 조건은 여기 넣지 않는다. */
export const placeOf = (conditions: readonly string[], labels?: readonly (readonly string[])[], answer?: string, roles?: ProseInput['conditionRoles']): string => {
  const entries = withoutAnswerPlace(conditions, answer, roles);
  const afters = entries.filter(item => AFTER.test(item.text));
  const { related, near: place } = splitRelated(entries.filter(item => !SATISFIED.test(item.text) && !AFTER.test(item.text)));
  // 8일: 위 집합은 "A의 B"로 잇는다(‘고래’의 ‘특징’에서)
  const upper = related.map(item => `${quote(readableLabel(item.text.replace(OWNER, '')))}의 `).join('');
  return `${place.length ? `${upper}${place.map(item => attributeTag(readableLabel(item.text.replace(OWNER, '')), labels?.[item.index])).join(', ')}에서 ` : ''}${afters.length
    // 5일: 겹친 `이후`(바깥 칸 다음 자리 안의 또 다음 자리)는 순서대로 이어 보인다: ‘A’ → ‘B’ 다음 자리의
    ? `${afters.map(item => attributeTag(readableLabel(item.text.replace(AFTER, '')), labels?.[item.index])).join(' → ')} 다음 자리의 ` : ''}`;
};

/** 문제 한 개의 줄글. 줄글로 바꾸지 않는 종류(노트 회상 · 능력 변환)는 null. attrs가 있으면 값마다 속성 이름을 붙인다. */
/**
 * 8일: 맞힐 값에 `{X}`가 있으면 부가조건 "(X에 해당하는 내용이 들어가도록)". 한 칸의 `{ }` 여럿은 모두 그 칸 하나가 공통으로 가진 요소라
 * 집합이 둘 이상이면 "모두 해당하는"으로 쓴다(`{염기}와 {물}` → 염기 · 물에 모두 해당하는 내용).
 */
export const keywordCondition = (keywords: readonly string[] | undefined): string => {
  const words = [...new Set((keywords ?? []).map(word => word.trim()).filter(Boolean))];
  if (!words.length) return '';
  return ` (${words.join(' · ')}에 ${words.length > 1 ? '모두 ' : ''}해당하는 내용이 들어가도록)`;
};

export const proseOf = (input: ProseInput, attrs?: ProseAttrs): Prose | null => {
  const prose = proseBody(input, attrs);
  const extra = keywordCondition(input.answerKeywords);
  return prose && extra ? { ...prose, statement: `${prose.statement}${extra}` } : prose;
};

const proseBody = (input: ProseInput, attrs?: ProseAttrs): Prose | null => {
  const { kind, prompt, answer, conditions, direction } = input;
  if (kind === 'recall' || kind === 'convert') return null;
  const labelsOf = (index: number) => attrs?.conditions[index];
  const entries = conditions.map((text, index) => ({ text, index }));
  const satisfied = entries.filter(item => SATISFIED.test(item.text));
  const where = placeOf(conditions, attrs?.conditions, answer, input.conditionRoles);
  // 이미 충족한 값들은 한 묶음으로: 속성 이름은 겹치지 않게 모은다
  const doneLabels = [...new Set(satisfied.flatMap(item => labelsOf(item.index) ?? []))];
  const done = satisfied.length ? `${attributeTag(satisfied.map(item => readableLabel(item.text.replace(SATISFIED, ''))).join(', '), doneLabels)} 외에 ` : '';
  const given = readableLabel(prompt);
  const givenTag = attributeTag(given, attrs?.prompt);
  const givenOperator = operatorOf(prompt);
  const answerOperator = operatorOf(answer);
  const solution = solutionOf(answer);
  // 31일: "이어지는"을 빼고 속성 이름으로 바로 묻는다(`개념 ‘자동차’의 정의는?`). 속성 이름이 없으면 "다음 값" · "앞의 값"
  const attr = attrs?.answer.length ? attrs.answer.join('·') : '';
  const noun = attr ? `${attr} 값` : '것';
  const ask = (direction: 'forward' | 'reverse') => attr || (direction === 'forward' ? '다음 값' : '앞의 값');
  // 속성 이름이 있으면 "‘A’의 정의", 없으면 "‘A’ 다음 값" · "‘A’ 앞의 값"
  const of = attr ? '의 ' : ' ';
  const tailOf = (word: string, operator: ReturnType<typeof operatorOf>) => (operator === 'and' ? `${object(word)} 모두 쓰시오.`
    : operator === 'sequence' ? `${object(word)} 순서대로 쓰시오.` : operator === 'or' ? `${word} 중 하나를 쓰시오.` : `${topic(word)}?`);

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
  // 홀로 쓴 `=`(31일): 뒤가 값 하나면 같은 것, `,`로 여러 값이면 구성요소로 묻는다
  if (input.form === 'components' && kind === 'remaining') {
    return { statement: `${where}${givenTag}의 구성요소 중 ${done}남은 ${answerOperator === 'and' ? object(attr || '것') + ' 모두 쓰시오.' : topic(attr || '것') + '?'}`, solution };
  }
  if (input.form === 'components') {
    return kind === 'direct'
      ? { statement: `${where}${givenTag}의 ${object('구성요소')} 모두 쓰시오.`, solution }
      : { statement: `${where}${madeOf(givenTag)} 이루어진 ${topic(attr || '것')}?`, solution };
  }
  // 8일: `=`로만 셋 이상 이은 줄은 한 값과 같은 것을 모두 묻는다(`b = d = c` → ‘b’와 같은 것을 모두 쓰시오 → d, c)
  if ((kind === 'direct' || kind === 'reverse') && input.form === 'equal') return { statement: `${where}${withAnd(givenTag)} ${answerOperator === 'and' ? '같은 것을 모두 쓰시오.' : '같은 것은?'}`, solution };
  // 10일: `,`로만 이은 줄은 한 값과 함께 쓴 나머지를 묻는다(`사과, 배` → ‘사과’과(와) 함께 쓴 것은? 배)
  if (kind === 'direct' && input.form === 'together') return { statement: `${where}${withAnd(givenTag)} ${answerOperator === 'and' ? '함께 쓴 것을 모두 쓰시오.' : '함께 쓴 것은?'}`, solution };
  // 칸 안의 `=`(다른 연결어가 있는 줄): 예전처럼 "대응하는 것"으로 묻는다(1일). 같은 것은 홀로 쓴 `=`만
  if ((kind === 'direct' || kind === 'reverse') && input.form === 'match') return { statement: `${where}${givenTag}에 대응하는 ${topic(attr || '것')}?`, solution };
  if (kind === 'direct') return { statement: `${where}${givenTag}${of}${tailOf(ask('forward'), answerOperator)}`, solution };
  if (kind === 'reverse') {
    const lead = givenOperator === 'and' ? `${where}${givenTag} 모두의 ` : givenOperator === 'sequence' ? `${where}${givenTag} 순서의 ` : `${where}${givenTag}${of}`;
    return { statement: `${lead}${answerOperator === 'or' ? `${ask('reverse')} 중 하나를 쓰시오.` : `${topic(ask('reverse'))}?`}`, solution };
  }
  if (kind === 'remaining' && input.beyond) {
    // 남은 값은 보이지 않고 머릿속으로 찾는다: 그 값의 다음 값을 묻는다(2일)
    const lead = `${where}${givenTag}에 필요한 것 중 ${done}남은 것의 다음 ${attr ? `${attr} 값` : '값'}`;
    return { statement: answerOperator === 'and' ? `${lead}을 모두 쓰시오.` : answerOperator === 'sequence' ? `${lead}을 순서대로 쓰시오.` : `${lead}은?`, solution };
  }
  if (kind === 'remaining') {
    const lead = `${where}${givenTag}에 필요한 것 중 ${done}남은 ${noun}`;
    return { statement: answerOperator === 'and' ? `${lead}을 모두 쓰시오.` : answerOperator === 'sequence' ? `${lead}을 순서대로 쓰시오.` : `${lead}은?`, solution };
  }
  if (kind === 'reconstruct') {
    return { statement: `${where}${givenTag} 다음의 ${object(attr || '값')} 끝까지 순서대로 쓰시오.`, solution };
  }
  if (kind === 'far') {
    const steps = input.distance && input.distance >= 2 ? count(input.distance) : '몇 걸음';
    return { statement: `${where}${givenTag}부터 ${steps} ${direction === 'reverse' ? '앞' : '뒤'}의 ${topic(attr || '값')}?`, solution };
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
/**
 * 능력 변환 문제의 줄글. 9일 "집합이었다 ~의였다 일관성이 없어, ~의로 처리하자고 했잖아(집합은 내부 논리상의 처리 방식)":
 * 기본 관계 문제와 같은 꼴로 쓴다 — 주어진 칸은 "‘집합’에서 ‘값’의", 묻는 칸은 그 집합 이름(`[A] B : [D] C` → ‘A’에서 ‘B’의 D은(는)?).
 * 칸에 `[ ]`를 쓴 집합은 상위(세션 · 토글 분류기준)와 따로인 항목이라 분류기준 이름(attrs)은 붙이지 않는다.
 */
export const convertStatement = (convert: ConvertProseInput, _attrs?: ConvertAttrs): string => {
  const given = convert.given ?? [0];
  const refs = given.map(index => `${quote(convert.steps[index].set)}에서 ${quote(convert.steps[index].cell)}`).join(', ');
  const names = convert.required.map(index => convert.steps[index].set);
  const asked = names.join(' · ');
  const first = convert.required[0];
  const partial = convert.partial?.[first];
  if (partial !== undefined) {
    let order = 0;
    const shown = partial.replace(/＿/g, () => `( ${blankMark(order++)} )`);
    const marks = Array.from({ length: Math.max(1, order) }, (_, index) => blankMark(index)).join(', ');
    const tail = order <= 1 ? `${marks}에 알맞은 것은?` : `${marks}에 알맞은 것을 ${partial.includes(', ') ? '쓰시오. (순서는 상관없다)' : '차례로 쓰시오.'}`;
    return `${refs}의 ${convert.steps[first].set} ${quote(shown)}에서 ${tail}`;
  }
  if (given.length === 1) {
    // 같은 집합 안의 단위 변환(`[번호] 1 : @+1`)은 연결어 방향대로 다음/앞을 쓴다
    const sameSet = convert.direction && convert.required.length === 1 && convert.steps.every(step => step.set === convert.steps[0].set);
    if (sameSet) return `${refs} ${convert.direction === 'reverse' ? '앞' : '다음'} ${topic('값')}?`;
    return convert.required.length === 1 ? `${refs}의 ${topic(asked)}?` : `${refs}의 ${object(asked)} 차례로 쓰시오.`;
  }
  const lowest = Math.min(...given);
  const highest = Math.max(...given);
  const place = convert.required.every(index => index > highest) ? '다음' : convert.required.every(index => index < lowest) ? '앞' : '사이';
  return `${refs} ${place}의 ${convert.required.length === 1 ? `${topic(asked)}?` : `${object(asked)} 차례로 쓰시오.`}`;
};
