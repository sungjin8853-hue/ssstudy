import React, { useMemo } from 'react';
import { buildReviewQuestions, conditionRolesAmong, getReviewQuestionClassification, getReviewQuestionSentence, REVIEW_QUESTION_KIND_LABELS } from '../utils/reviewQuestions';
import { buildNoteSetIndex, headCellOf, keywordMembers, noteCriterionOf, questionAbilities, upperSetsOf } from '../utils/noteSets';
import type { NoteQuestion } from '../utils/reviewQuestions';
import { ReviewNoteSummary } from './ReviewNoteSummary';
import { ConvertQuestionContent } from './ConvertQuestionContent';
import { ProcessToggle } from './ProcessToggle';
import { FlashKeywords } from './FlashKeywords';
import { flashOf } from '../utils/questionFlash';
import { useReviewStyle } from './ReviewStyleSelector';
import { KeywordText } from './KeywordText';

/**
 * 복습 문제 한 장. 고른 모양(줄글 · 플래시 카드)이 모든 복습 문제에 적용된다.
 * - 줄글: 문제집처럼 문장 하나. 세션 노트 기준 줄(노트:정의)과 조건 칩은 없고, 맞힐 값 · 주어진 값 · 문제 조건의 속성은 문장 안에서 드러난다
 *   (`개념 ‘자동차’에서 정의 ‘엔진’에 이어지는 예시 값은?`).
 * - 플래시 카드: 앞면에 문제 조건과 맞힐 속성을 크고 분명하게 보이고, 뒷면(정답 확인)에 정답이 나온다. 세션 노트 분류 줄(`개념:정의:예시`)은 어느 모양에도 따로 보이지 않는다(값마다 붙는 속성 이름만 있다).
 */
const normalizeCell = (text: string) => text.replace(/\s+/g, '');

export const ReviewQuestionContent: React.FC<{
  question: NoteQuestion;
  criterion?: string | null;
  revealed: boolean;
  memo: string;
  /** 같은 과목의 모든 노트 글: 다른 쪽에서 정의한 능력 집합까지 찾을 때 쓴다. 없으면 이 노트 글만 본다. */
  setMemos?: readonly string[];
}> = ({ question: given, criterion, revealed, memo, setMemos }) => {
  const style = useReviewStyle();
  const memoKey = setMemos ? setMemos.join('\u0000') : '';
  // 7일: 문제 조건은 가장 가까운 집합만(위치를 가릴 만큼만 위 집합을 더함). 같은 과목의 다른 노트 문제와도 구별되게 함께 본다
  const pool = useMemo(() => (setMemos && setMemos.length > 1 ? setMemos.flatMap(text => buildReviewQuestions(text).questions) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [memoKey]);
  const question = useMemo(() => (pool ? { ...given, conditionRoles: conditionRolesAmong(given, pool) ?? given.conditionRoles } : given), [given, pool]);
  // 세션 노트 기준이 없으면 노트 맨 위에 `[개념:정의]`로 쓴 노트 전체 기준을 쓴다.
  // 토글 제목에 쓴 `[개념:정의]`가 있으면 그 토글 안의 문제는 그 기준을 따른다(상위 토글 → 세션 노트 → 노트 전체 기준 순).
  const activeCriterion = question.criterion || criterion || noteCriterionOf(memo);
  const labels = getReviewQuestionClassification(activeCriterion, question);
  const abilities = useMemo(
    () => questionAbilities(question, buildReviewQuestions(memo).nodes, setMemos && setMemos.length ? setMemos : [memo]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [question, memo, memoKey]
  );
  // 다른 논리어 없이 `=`·`-`·`,`만 쓴 줄의 문제(2일 · 10일): 능력 정의가 없으면 앞 값(연결되기 전 값)의 능력 집합을 반드시 먼저 알려 준다.
  // 10일 "능력적 집합을 반드시 보여 주고(세션 노트만이 아니라 기존 분류조건까지)": 상위 집합과 함께 걸린 분류기준을 모두 보인다
  // (토글 제목 · 세션 노트 · 노트 맨 위 기준 순, 같은 것은 한 번).
  const loneSets = useMemo(() => {
    if (!question.lone) return [];
    const beforeIsPrompt = question.direction === 'forward';
    const cell = headCellOf(beforeIsPrompt ? question.prompt : question.answer);
    if (abilities.some(ability => normalizeCell(ability.cell) === normalizeCell(cell))) return [];
    const sets = upperSetsOf(buildNoteSetIndex(setMemos && setMemos.length ? setMemos : [memo]), cell);
    const criteria = [...new Set([question.criterion, criterion, noteCriterionOf(memo)].map(item => (item ?? '').trim()).filter(Boolean))];
    return sets.length || criteria.length ? [{ cell, sets, criteria, hidden: !beforeIsPrompt }] : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question, memo, memoKey, abilities, criterion]);
  // 8일: 맞힐 값에 `{X}`가 있으면 구체적인 값을 써도 맞다: X에 든 값들(여럿이면 모두에 든 값)을 정답 아래에 보인다
  const keywordValues = useMemo(() => {
    const words = question.answerKeywords ?? [];
    if (!words.length) return null;
    const index = buildNoteSetIndex(setMemos && setMemos.length ? setMemos : [memo]);
    const answerParts = new Set(question.answer.split(/\s*(?:AND|OR|→|=|,)\s*/).map(part => part.replace(/\s+/g, '')));
    const values = keywordMembers(index, words).filter(value => !answerParts.has(value.replace(/\s+/g, '')));
    return { words, values: values.slice(0, 12), more: values.length > 12 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question, memo, memoKey]);
  const keywordNote = keywordValues && <p data-keyword-accept="true" className="max-w-3xl text-center text-base font-bold text-indigo-900">
    {keywordValues.words.join(' · ')}에 {keywordValues.words.length > 1 ? '모두 ' : ''}해당하는 값이면 맞아요{keywordValues.values.length ? `: ${keywordValues.values.join(', ')}${keywordValues.more ? ' …' : ''}` : ''}
  </p>;
  const prose = style === 'prose';
  if (question.convert) return <ConvertQuestionContent question={question} criterion={activeCriterion} revealed={revealed} />;
  const sentence = prose ? getReviewQuestionSentence(activeCriterion, question) : null;
  const abilityPanel = (abilities.length > 0 || loneSets.length > 0) && <section aria-label="능력 집합" className="w-full max-w-4xl rounded-2xl border-2 border-indigo-200 bg-indigo-50 px-4 py-3 md:px-5">
    <h3 className="mb-2 text-sm font-black text-indigo-900">능력 집합</h3>
    <div data-ability-chips="true" className="flex flex-wrap justify-center gap-2.5">
      {loneSets.map(item => <span key={`lone|${item.cell}`} data-ability-chip="true" data-ability-upper="true"
        className="rounded-xl bg-white px-4 py-2.5 text-lg font-black text-indigo-950 ring-2 ring-indigo-300 md:text-xl">
        {item.hidden && !revealed ? <span data-ability-hidden="true" className="text-indigo-400">＿</span> : item.cell}{item.sets.length > 0 && <> ∈ {item.sets.join(', ')}</>}
        {item.criteria.length > 0 && <> <span className="text-indigo-600">→</span> <span data-ability-criteria="true">{item.criteria.join(' · ')}</span></>}
      </span>)}
      {abilities.map(ability => <span key={`${ability.cell}|${ability.expression}|${ability.criterion}`} data-ability-chip="true"
        className="rounded-xl bg-white px-4 py-2.5 text-lg font-black text-indigo-950 ring-2 ring-indigo-300 md:text-xl">
        {/* 맞힐 칸의 집합은 문제 조건으로 주되, 답을 보기 전에는 셀 이름을 가린다(2일: 답이 미리 보이던 것) */}
        {ability.side === 'answer' && !revealed ? <span data-ability-hidden="true" className="text-indigo-400">＿</span> : ability.cell} ∈ {ability.expression} <span className="text-indigo-600">→</span> {ability.criterion}
      </span>)}
    </div>
  </section>;
  const kindTag = <span className="rounded-md bg-indigo-100 px-3 py-1 text-[13px] font-black text-indigo-900">{REVIEW_QUESTION_KIND_LABELS[question.kind]}</span>;
  const answerText = (text: string) => question.kind === 'recall' ? <ReviewNoteSummary memo={memo} />
    : <p className="rounded-2xl bg-indigo-100 px-5 py-3 font-serif text-2xl font-semibold leading-snug text-indigo-950 md:text-4xl"><KeywordText text={text} /></p>;

  if (prose) {
    const text = sentence?.statement ?? question.statement;
    const solved = sentence ? sentence.solution : question.solution;
    return <div data-review-style="prose" className="flex flex-col items-center gap-5">
      {abilityPanel}
      {kindTag}
      <div data-question-field="prompt" className="space-y-2">
        {text
          ? <p data-question-statement="true" className="max-w-3xl break-keep font-serif text-2xl font-bold leading-relaxed tracking-tight text-slate-900 md:text-4xl"><KeywordText text={text} /></p>
          : <p className="font-serif text-3xl font-bold leading-snug tracking-tight text-slate-900 md:text-5xl"><KeywordText text={question.prompt} /></p>}
      </div>
      {revealed && <div data-question-field="answer" className="space-y-2">
        {answerText(solved ?? question.answer)}
        {keywordNote}
        <ProcessToggle process={question.process} resetKey={question.key} revealed={revealed} />
      </div>}
    </div>;
  }

  // 플래시 카드: 줄글 문장에서 키워드만 따서 가로로 늘어놓는다(자리 → 주어진 값 → 이어 주는 말 → 맞힐 칸). 정답을 확인하면 맞힐 칸이 정답으로 바뀐다.
  const flash = flashOf(question, { prompt: labels.prompt, answer: labels.answer, conditions: labels.conditions });
  if (flash) {
    return <div data-review-style="flash" className="flex flex-col items-center gap-6">
      {abilityPanel}
      {kindTag}
      <FlashKeywords card={flash} revealed={revealed} answerText={question.solution ?? question.answer} />
      {revealed && keywordNote}
      <ProcessToggle process={question.process} resetKey={question.key} revealed={revealed} />
    </div>;
  }
  // 줄글로 바꾸지 않는 종류(노트 회상): 주어진 속성 · 문제 조건 · 맞힐 속성을 크고 분명하게 (구조로 낸 글 그대로)
  return <div data-review-style="flash" className="flex flex-col items-center gap-6">
    {abilityPanel}
    {kindTag}
    {question.conditions.length > 0 && <section aria-label="문제 조건" data-flash-conditions="true" className="flex w-full max-w-4xl flex-col items-center gap-2">
      <h3 className="text-sm font-black tracking-wide text-slate-600">문제 조건</h3>
      <div className="flex flex-wrap justify-center gap-3">
        {question.conditions.map((condition, index) => <span key={index} data-flash-condition="true"
          className="flex min-w-[8rem] flex-col items-center rounded-2xl border-2 border-slate-300 bg-slate-100 px-5 py-3 text-center">
          {labels.conditions[index].length > 0 && <span data-field-label="true" className="mb-1 text-base font-black text-slate-600">{labels.conditions[index].join(' · ')}</span>}
          <span className="font-serif text-2xl font-bold leading-snug text-slate-900 md:text-3xl"><KeywordText text={condition} /></span>
        </span>)}
      </div>
    </section>}
    <div data-question-field="prompt" className="flex flex-col items-center gap-2">
      {labels.prompt.length > 0 && <p data-field-label="true" className="rounded-lg bg-slate-200 px-4 py-1.5 text-lg font-black text-slate-800">{labels.prompt.join(' · ')}</p>}
      <p className="font-serif text-3xl font-bold leading-snug tracking-tight text-slate-900 md:text-5xl"><KeywordText text={question.prompt} /></p>
    </div>
    {(labels.answer.length > 0 || revealed) && <div data-question-field="answer" className="flex flex-col items-center gap-2">
      {labels.answer.length > 0 && <p data-field-label="true" data-flash-ask="true" className="rounded-xl bg-amber-500 px-5 py-2 text-xl font-black text-white md:text-2xl">맞힐 것 · {labels.answer.join(' · ')}</p>}
      {revealed && answerText(question.solution ?? question.answer)}
      <ProcessToggle process={question.process} resetKey={question.key} revealed={revealed} />
    </div>}
  </div>;
};
