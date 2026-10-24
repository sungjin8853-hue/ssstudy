import React from 'react';
import type { NoteQuestion } from '../utils/reviewQuestions';
import { ProcessToggle } from './ProcessToggle';
import { convertStatement } from '../utils/questionProse';
import { getReviewQuestionClassification } from '../utils/reviewQuestions';
import { useReviewStyle } from './ReviewStyleSelector';

/**
 * 능력 변환 문제 한 장. 문제집처럼 문장으로 묻는다: 주어진 값(들)과 능력 집합은 문장 안에 쓰고, 카드에는 맞힐 칸만 둔다(집합 이름 아래 ? → 정답).
 * 자유도로 건너뛴 칸과 그 관계는 문장에도 카드에도 없다(능력 정의가 건너뜀을 허용하면 스스로 이끌어 낼 수 있다).
 * 정답 칸만 정답을 확인할 때 채워진다. 건너뛴 칸까지 이은 풀이 길은 "풀이 과정" 버튼을 눌러야 보인다.
 * 변주 문제는 한 줄의 여러 칸이 주어지거나, 정답 칸의 덩어리 일부만 가려진 채(㉠ ㉡) 문장에 들어간다.
 */
/** 덩어리 칸(`읽기-정리-확인` · `B, C`)은 항목 사이에서만 줄을 바꾸고, 긴 글은 글씨를 줄인다 */
const ChunkText: React.FC<{ text: string; partial?: boolean }> = ({ text, partial }) => {
  const size = text.length > 14 ? 'text-xl md:text-2xl' : text.length > 6 ? 'text-2xl md:text-3xl' : text.length > 4 ? 'text-3xl md:text-4xl' : 'text-3xl md:text-5xl';
  return <span data-convert-partial={partial ? 'true' : undefined} className={`font-serif font-bold leading-snug tracking-tight ${size}`}>
    {text.split(/(?<=-|, )/).map((token, index) => <span key={index} className="inline-block whitespace-nowrap">{token}</span>)}
  </span>;
};

export const ConvertQuestionContent: React.FC<{
  question: NoteQuestion;
  revealed: boolean;
  /** 세션 노트 분류기준: 있으면 문장 안에 값마다 속성 이름이 들어간다(줄글) · 카드 칸 위에 크게 보인다(플래시 카드) */
  criterion?: string | null;
}> = ({ question, revealed, criterion }) => {
  const convert = question.convert!;
  const style = useReviewStyle();
  const labels = getReviewQuestionClassification(criterion, question);
  if (style === 'flash') return <ConvertFlash question={question} revealed={revealed} labels={labels} />;
  // 주어진 값은 문장 안에 쓰고, 카드에는 맞힐 칸(집합 이름 아래 ? → 정답)만 둔다
  const required = convert.required.map(index => ({ step: convert.steps[index], index }));
  return <div data-convert-question="true" data-convert-form={convert.form} data-convert-variation={convert.variation} className="flex w-full max-w-4xl flex-col items-center gap-4">
    <div data-question-field="prompt" className="w-full text-center">
      <p data-question-statement="true" className="mx-auto max-w-3xl break-keep font-serif text-2xl font-bold leading-relaxed tracking-tight text-slate-900 md:text-4xl">{convertStatement({ ...convert, direction: question.direction }, { given: labels.prompt, required: labels.answer })}</p>
    </div>
    <ol className="m-0 flex list-none flex-wrap items-stretch justify-center gap-x-3 gap-y-4 p-0">
      {required.map(({ step }, index) => <React.Fragment key={index}>
        {index > 0 && <li aria-hidden="true" className="flex select-none items-center text-3xl font-black text-indigo-400">→</li>}
        <li data-question-field="answer" data-convert-slot="answer" data-revealed={revealed ? 'true' : undefined}
          className={`flex min-w-[11rem] max-w-full flex-1 flex-col items-center justify-center gap-1 rounded-2xl px-5 py-4 text-center ${revealed ? 'bg-indigo-100 text-indigo-950' : 'border-2 border-dashed border-amber-300 bg-amber-50 text-amber-700'}`}>
          <span data-convert-set={step.set} className={`text-base font-black leading-tight md:text-lg ${revealed ? 'text-indigo-700' : 'text-indigo-600'}`}>{step.set}</span>
          {revealed
            ? (convert.partial?.[convert.required[index]] !== undefined
              ? <ChunkText text={step.cell} />
              : <span className="break-words font-serif text-3xl font-bold leading-snug tracking-tight md:text-5xl">{step.cell}</span>)
            : <span className="text-4xl font-black leading-none">?</span>}
        </li>
      </React.Fragment>)}
    </ol>
    <ProcessToggle process={question.process} resetKey={question.key} revealed={revealed} />
  </div>;
};

/** 플래시 카드 모양: 주어진 값과 맞힐 값을 칸으로 늘어놓고, 칸마다 집합 이름 아래에 값(크게). 속성 이름은 칸 위에 크게 붙는다. */
const ConvertFlash: React.FC<{
  question: NoteQuestion;
  revealed: boolean;
  labels: ReturnType<typeof getReviewQuestionClassification>;
}> = ({ question, revealed, labels }) => {
  const convert = question.convert!;
  const givenSteps = convert.given ?? [0];
  const shown = convert.steps.map((step, index) => ({ step, index })).filter(({ index }) => givenSteps.includes(index) || convert.required.includes(index));
  return <div data-convert-question="true" data-review-style="flash" data-convert-form={convert.form} data-convert-variation={convert.variation} className="flex w-full max-w-4xl flex-col items-center gap-4">
    <ol className="m-0 flex list-none flex-wrap items-stretch justify-center gap-x-3 gap-y-4 p-0">
      {shown.map(({ step, index: stepIndex }, index) => {
        const given = givenSteps.includes(stepIndex);
        const partial = convert.partial?.[stepIndex];
        return <React.Fragment key={index}>
          {index > 0 && <li aria-hidden="true" className="flex select-none items-center text-3xl font-black text-indigo-400">→</li>}
          <li data-question-field={given ? 'prompt' : 'answer'} data-convert-given={given ? 'true' : undefined}
            data-convert-slot={given ? undefined : 'answer'} data-revealed={!given && revealed ? 'true' : undefined}
            className={`flex min-w-[11rem] max-w-full flex-1 flex-col items-center justify-center gap-1 rounded-2xl px-5 py-4 text-center ${partial !== undefined ? 'md:min-w-[18rem]' : ''} ${given ? 'bg-indigo-700 text-white'
              : revealed ? 'bg-indigo-100 text-indigo-950' : 'border-2 border-dashed border-amber-300 bg-amber-50 text-amber-700'}`}>
            {(given ? labels.prompt : labels.answer).length > 0 && <span data-field-label="true" className={`rounded-md px-3 py-0.5 text-base font-black ${given ? 'bg-white/20 text-white' : 'bg-amber-500 text-white'}`}>
              {given ? '' : '맞힐 것 · '}{(given ? labels.prompt : labels.answer).join(' · ')}</span>}
            <span data-convert-set={step.set} className={`text-base font-black leading-tight md:text-lg ${given ? 'text-indigo-100' : revealed ? 'text-indigo-700' : 'text-indigo-600'}`}>{step.set}</span>
            {given || revealed
              ? (convert.partial?.[stepIndex] !== undefined
                ? <ChunkText text={step.cell} />
                : <span className="break-words font-serif text-3xl font-bold leading-snug tracking-tight md:text-5xl">{step.cell}</span>)
              : partial
                ? <ChunkText text={partial} partial />
                : <span className="text-4xl font-black leading-none">?</span>}
          </li>
        </React.Fragment>;
      })}
    </ol>
    <ProcessToggle process={question.process} resetKey={question.key} revealed={revealed} />
  </div>;
};
