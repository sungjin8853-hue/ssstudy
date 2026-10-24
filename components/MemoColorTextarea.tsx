import React, { forwardRef, useLayoutEffect, useRef } from 'react';
import { getReviewMemoColonColor, getReviewMemoLogicColor, getReviewMemoOperatorColor, markReviewMemoLogicWords, markReviewMemoOperators, splitReviewMemoColonColors } from '../utils/reviewMemoColors';
import type { MemoColorPart } from '../utils/reviewMemoColors';
import { GHOST_MARK } from '../utils/noteGhost';
import type { GhostInsert } from '../utils/noteGhost';

interface Props extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  colorColons: boolean;
  dark?: boolean;
  wrapperClassName?: string;
  fieldOverrides?: ReadonlyMap<number, string>;
  /** 이 글이 시작하는 칸 번호(끝이 열린 토글 제목 아래 줄은 제목 뒤에서 시작) */
  fieldBase?: number;
  /**
   * 줄 맨 앞에 글자처럼 끼워 넣은 위치 `[..B]`. 이때 value는 끼운 글이 들어간 보이는 글이고, storedValue는 끼우기 전의 저장하는 글이다.
   * 색은 저장하는 글로 정해 끼운 글이 색칠에 끼어들지 않고, 끼운 글만 어두운 점선 밑줄로 보인다(글자 폭은 그대로).
   */
  ghosts?: readonly GhostInsert[];
  storedValue?: string;
}

const GHOST_LIGHT = '#475569';
const GHOST_DARK = '#e2e8f0';

/** 색 조각을 끼운 글 자리에서 나누어 끼운 글 조각을 넣는다 */
const withGhostParts = (text: string, parts: MemoColorPart[], ghosts: readonly GhostInsert[]): Array<MemoColorPart & { ghost?: string }> => {
  const starts = new Map<number, string>();
  let offset = 0;
  text.split('\n').forEach((line, at) => {
    const label = ghosts.find(item => item.line === at)?.label;
    if (label !== undefined) starts.set(offset, label);
    offset += line.length + 1;
  });
  const cuts = [...starts.keys()].sort((a, b) => a - b);
  const result: Array<MemoColorPart & { ghost?: string }> = [];
  let at = 0;
  let next = 0;
  const pushGhost = (cut: number) => result.push({ text: `${GHOST_MARK}${starts.get(cut)} ${GHOST_MARK}`, ghost: starts.get(cut) });
  parts.forEach(part => {
    let rest = part.text;
    while (next < cuts.length && cuts[next] < at + rest.length) {
      const cut = cuts[next];
      if (cut > at) { result.push({ ...part, text: rest.slice(0, cut - at) }); rest = rest.slice(cut - at); at = cut; }
      pushGhost(cut);
      next += 1;
    }
    if (rest) result.push({ ...part, text: rest });
    at += rest.length;
  });
  while (next < cuts.length) { pushGhost(cuts[next]); next += 1; }
  return result;
};

export const MemoColorTextarea = forwardRef<HTMLTextAreaElement, Props>(function MemoColorTextarea({
  value, colorColons, dark = false, wrapperClassName = '', fieldOverrides, fieldBase = 0, ghosts, storedValue, ...props
}, ref) {
  const mirror = useRef<HTMLDivElement | null>(null);
  const field = useRef<HTMLTextAreaElement | null>(null);
  const hasGhosts = !!ghosts?.length && storedValue !== undefined;
  const showColors = (colorColons || hasGhosts) && !!value;
  const syncMirror = () => {
    if (!field.current || !mirror.current) return;
    const style = getComputedStyle(field.current);
    const border = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
    const scrollbar = Math.max(0, field.current.offsetWidth - field.current.clientWidth - border);
    mirror.current.style.paddingRight = `${parseFloat(style.paddingRight) + scrollbar}px`;
    mirror.current.scrollTop = field.current.scrollTop;
    mirror.current.scrollLeft = field.current.scrollLeft;
  };
  useLayoutEffect(() => {
    syncMirror();
    if (!field.current || !showColors) return;
    const observer = new ResizeObserver(syncMirror);
    observer.observe(field.current);
    return () => observer.disconnect();
  }, [value, showColors]);
  const mirrorText = hasGhosts ? storedValue! : String(value);
  const mirrorParts: Array<MemoColorPart & { ghost?: string }> = !showColors ? [] : (() => {
    const colored = colorColons ? markReviewMemoOperators(mirrorText, markReviewMemoLogicWords(mirrorText, splitReviewMemoColonColors(mirrorText, fieldOverrides, fieldBase))) : [{ text: mirrorText }];
    return hasGhosts ? withGhostParts(mirrorText, colored, ghosts!) : colored;
  })();
  return <div className={`relative ${wrapperClassName}`}>
    <textarea {...props} ref={element => {
      field.current = element;
      if (typeof ref === 'function') ref(element);
      else if (ref) ref.current = element;
    }} value={value} className={`block ${props.className || ''}`}
      style={showColors ? { ...props.style, color: 'transparent', caretColor: dark ? '#fff1f2' : '#1e293b' } : props.style}
      onScroll={event => {
        syncMirror();
        props.onScroll?.(event);
      }} />
    {showColors && (
      <div ref={mirror} aria-hidden="true" className={`${props.className || ''} pointer-events-none absolute inset-0 whitespace-pre-wrap break-words`}
        style={{ ...props.style, height: '100%', width: '100%', margin: 0, background: 'transparent', borderColor: 'transparent', overflow: 'hidden', overflowWrap: 'break-word', resize: 'none' }}>
        {mirrorParts.map((part, index) => {
          // 끼운 위치는 글자 폭을 그대로 두고 색(어둡게)과 점선 밑줄만 다르게 보인다
          if (part.ghost !== undefined) return <span key={index} data-note-ghost={part.ghost} style={{ color: dark ? GHOST_DARK : GHOST_LIGHT, textDecoration: 'underline dotted', textUnderlineOffset: 4 }}>{part.text}</span>;
          // 논리어(`[ ]` 덩어리)는 안쪽의 `:` 같은 기호까지 논리어 색 하나로 쓴다
          if (part.logic) return <span key={index} data-logic-word="true" style={{ color: getReviewMemoLogicColor(dark) }}>{part.text}</span>;
          // 한 칸 안의 논리어(`,` 그리고 · `-` 다음 · `=` 같음)는 종류마다 색이 달라, 글자 폭은 그대로 두고 색만 바뀐다
          if (part.operator) return <span key={index} data-logic-operator={part.operator} style={{ color: getReviewMemoOperatorColor(part.operator, dark) }}>{part.text}</span>;
          return part.colonIndex === undefined
            ? <React.Fragment key={index}>{part.text}</React.Fragment>
            : <span key={index} data-colon-index={part.colonIndex + 1} style={{ color: getReviewMemoColonColor(part.colonIndex, dark) }}>{part.text}</span>;
        })}
        {'\u200b'}
      </div>
    )}
  </div>;
});
