import React from 'react';
import { getReviewQuestionClassification, REVIEW_QUESTION_KIND_LABELS } from '../utils/reviewQuestions';
import type { NoteQuestion } from '../utils/reviewQuestions';
import { ReviewNoteSummary } from './ReviewNoteSummary';

export const ReviewQuestionContent: React.FC<{
  question: NoteQuestion;
  criterion?: string | null;
  revealed: boolean;
  memo: string;
}> = ({ question, criterion, revealed, memo }) => {
  const labels = getReviewQuestionClassification(criterion, question);
  return <div className="flex flex-col items-center gap-5">
    {criterion && <p data-classification-criterion="true" className="text-sm font-bold text-slate-500">{criterion}</p>}
    {question.conditions.length > 0 && <div className="flex flex-wrap justify-center gap-2 text-sm text-slate-600">
      {question.conditions.map((condition, index) => <span key={index} className="rounded-lg bg-slate-100 px-3 py-2">
        {labels.conditions[index].length > 0 && <span className="mb-1 block text-[10px] font-bold text-slate-400">{labels.conditions[index].join(' · ')}</span>}
        {condition}
      </span>)}
    </div>}
    <span className="text-xs font-bold text-rose-500">{REVIEW_QUESTION_KIND_LABELS[question.kind]}</span>
    <div data-question-field="prompt" className="space-y-2">
      {labels.prompt.length > 0 && <p data-field-label="true" className="text-sm font-bold text-slate-500">{labels.prompt.join(' · ')}</p>}
      <p className="text-3xl font-black text-slate-900 md:text-5xl">{question.prompt}</p>
    </div>
    {(labels.answer.length > 0 || revealed) && <div data-question-field="answer" className="space-y-2">
      {labels.answer.length > 0 && <p data-field-label="true" className="text-sm font-bold text-amber-700">{labels.answer.join(' · ')}</p>}
      {revealed && (question.kind === 'recall' ? <ReviewNoteSummary memo={memo} />
        : <p className="rounded-2xl bg-amber-300 px-5 py-3 text-2xl font-black text-slate-950 md:text-4xl">{question.answer}</p>)}
    </div>}
  </div>;
};
