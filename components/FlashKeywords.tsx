import React from 'react';
import type { FlashCard, FlashChip, FlashPiece } from '../utils/questionFlash';

/**
 * 플래시 카드의 키워드 줄: 줄글 문장에서 키워드만 따서 가로로 늘어놓는다(위 줄글과 같은 순서).
 *   [개념 자동차] › [정의 엔진] ──이어지는→ [맞힐 것 · 예시 ?]
 * 문제가 놓인 자리는 회색 칸, 주어진 값은 굵은 테두리 칸, 맞힐 칸은 점선 칸(`?`)이다.
 * 정답을 확인하면 맞힐 칸이 같은 자리에서 정답으로 바뀐다. 좁은 화면에서는 줄이 바뀐다.
 */
const MODE_TEXT: Record<string, string> = { 모두: '모두 쓰기', 순서대로: '순서대로 쓰기', 하나만: '하나만 쓰기', 차례로: '차례로 쓰기' };
const ARROW = { forward: '→', back: '←', equal: '＝' } as const;

const Separator: React.FC<{ glyph: string; small?: boolean }> = ({ glyph, small }) => (
  <li aria-hidden="true" className={`flex select-none items-center font-black text-indigo-400 ${small ? 'text-2xl' : 'text-3xl'}`}>{glyph}</li>
);

/** 정답이 길수록 글씨를 줄여 키워드와 같은 줄에 남게 한다(그래도 넘치면 칸 안에서 줄을 바꾼다) */
const answerSize = (text: string) => (text.length > 14 ? 'text-xl md:text-2xl' : text.length > 6 ? 'text-2xl md:text-3xl' : 'text-3xl md:text-4xl');

const Slot: React.FC<{ revealed: boolean; answer: string | null; mark?: string; blank?: boolean }> = ({ revealed, answer, mark, blank }) => (
  revealed && answer !== null
    ? <span data-flash-answer="true" className="flex flex-col items-center gap-0.5 rounded-2xl bg-indigo-100 px-5 py-3 text-center">
      {mark && <span className="text-sm font-black text-indigo-700">{mark}</span>}
      <span className={`break-words font-serif font-semibold leading-snug text-indigo-950 ${answerSize(answer)}`}>{answer}</span>
    </span>
    : <span data-flash-slot="true" data-flash-blank={blank ? 'true' : undefined} aria-label={mark ? `가려진 정답 ${mark}` : '가려진 정답'}
      className="flex min-w-[6rem] flex-col items-center gap-0.5 rounded-2xl border-2 border-dashed border-amber-400 bg-amber-50 px-6 py-3 text-center text-amber-600">
      {mark && <span className="text-sm font-black">{mark}</span>}
      <span className="text-5xl font-black leading-none">?</span>
    </span>
);

const PlaceChip: React.FC<{ chip: FlashChip & { role: 'place' | 'owner' | 'after' } }> = ({ chip }) => (
  <li data-flash-condition="true" data-flash-role={chip.role}
    className="flex min-w-[6rem] max-w-full flex-col items-center justify-center gap-1 rounded-2xl border-2 border-slate-300 bg-slate-100 px-4 py-2.5 text-center">
    {chip.label.length > 0 && <span data-field-label="true" className="text-sm font-black text-slate-600">{chip.label.join(' · ')}</span>}
    <span className="break-words font-serif text-xl font-bold leading-snug text-slate-900 md:text-2xl">{chip.value}</span>
    {chip.role === 'after' && <span data-flash-after="true" className="text-xs font-black text-slate-500">다음 자리</span>}
    {chip.role === 'owner' && <span data-flash-owner="true" className="text-xs font-black text-slate-500">의</span>}
  </li>
);

const Pieces: React.FC<{ pieces: FlashPiece[]; revealed: boolean }> = ({ pieces, revealed }) => {
  const blanks = pieces.filter(piece => piece.type === 'blank').length;
  return <div data-flash-chain="true" className="flex flex-wrap items-center justify-center gap-2">
    {pieces.map((piece, index) => {
      if (piece.type === 'glue') return <span key={index} aria-hidden="true" className="select-none text-3xl font-black text-indigo-400">{piece.glyph}</span>;
      if (piece.type === 'text') {
        return piece.value.trim() === '…'
          ? <span key={index} className="select-none text-2xl font-black text-slate-400">…</span>
          : <span key={index} data-flash-piece="true" className="break-words rounded-2xl border-2 border-indigo-700 bg-white px-4 py-2.5 font-serif text-2xl font-bold leading-snug text-slate-900 md:text-3xl">{piece.value}</span>;
      }
      return <div key={index} data-question-field="answer" data-revealed={revealed ? 'true' : undefined}>
        <Slot revealed={revealed} answer={piece.answer} mark={blanks > 1 ? piece.mark : undefined} blank />
      </div>;
    })}
  </div>;
};

export const FlashKeywords: React.FC<{ card: FlashCard; revealed: boolean; answerText: string }> = ({ card, revealed, answerText }) => {
  const { place, given, done, relation, chain, ask } = card;
  const loose = Boolean(chain && revealed && chain.some(piece => piece.type === 'blank' && piece.answer === null));
  return (
    <ol data-flash-row="true" aria-label="문제 키워드" className="m-0 flex w-full max-w-5xl list-none flex-wrap items-stretch justify-center gap-x-2 gap-y-4 p-0">
      {place.map((chip, index) => <React.Fragment key={`place-${index}`}>
        <PlaceChip chip={chip} />
        {(index < place.length - 1 || given || chain) && <Separator glyph="›" small />}
      </React.Fragment>)}
      {given && <li data-question-field="prompt" className="flex min-w-[8rem] max-w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-indigo-700 bg-white px-5 py-3 text-center">
        {given.label.length > 0 && <p data-field-label="true" className="rounded-lg bg-slate-200 px-4 py-1.5 text-lg font-black text-slate-800">{given.label.join(' · ')}</p>}
        <p className="break-words font-serif text-3xl font-bold leading-snug tracking-tight text-slate-900 md:text-4xl">{given.value}</p>
      </li>}
      {done && <li data-flash-done="true" className="flex min-w-[6rem] max-w-full flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-slate-300 bg-white px-4 py-2.5 text-center">
        <span data-field-label="true" className="text-sm font-black text-slate-600">✓ 이미 충족{done.label.length > 0 ? ` · ${done.label.join(' · ')}` : ''}</span>
        <span className="break-words font-serif text-xl font-bold leading-snug text-slate-700 md:text-2xl">{done.value}</span>
      </li>}
      {relation && <li data-flash-relation={relation.arrow} className="flex min-w-[4.5rem] flex-col items-center justify-center gap-0.5 px-1 text-indigo-700">
        <span className="text-center text-sm font-black leading-tight md:text-base">{relation.word}</span>
        <span aria-hidden="true" className="select-none text-3xl font-black leading-none">{ARROW[relation.arrow]}</span>
      </li>}
      <li className={`flex min-w-[9rem] flex-col items-center justify-center gap-2 ${chain ? 'max-w-full' : 'max-w-[18rem]'}`}>
        {chain ? <>
          {ask.label.length > 0 && <p data-field-label="true" data-flash-ask="true" className="rounded-xl bg-amber-500 px-5 py-2 text-xl font-black text-white md:text-2xl">맞힐 것 · {ask.label.join(' · ')}</p>}
          <Pieces pieces={chain} revealed={revealed} />
          {loose && <p data-flash-answer="true" className="rounded-2xl bg-indigo-100 px-5 py-3 text-center font-serif text-2xl font-semibold leading-snug text-indigo-950 md:text-4xl">{answerText}</p>}
        </> : <div data-question-field="answer" data-revealed={revealed ? 'true' : undefined} className="flex flex-col items-center gap-2">
          {ask.label.length > 0 && <p data-field-label="true" data-flash-ask="true" className="rounded-xl bg-amber-500 px-5 py-2 text-xl font-black text-white md:text-2xl">맞힐 것 · {ask.label.join(' · ')}</p>}
          <Slot revealed={revealed} answer={answerText} />
        </div>}
        {ask.mode && <p data-flash-mode="true" className="text-sm font-black text-amber-800">{MODE_TEXT[ask.mode] ?? ask.mode}</p>}
      </li>
    </ol>
  );
};
