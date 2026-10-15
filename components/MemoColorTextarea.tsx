import React, { forwardRef, useLayoutEffect, useRef } from 'react';
import { getReviewMemoColonColor, splitReviewMemoColonColors } from '../utils/reviewMemoColors';

interface Props extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  colorColons: boolean;
  dark?: boolean;
  wrapperClassName?: string;
  fieldOverrides?: ReadonlyMap<number, string>;
}

export const MemoColorTextarea = forwardRef<HTMLTextAreaElement, Props>(function MemoColorTextarea({
  value, colorColons, dark = false, wrapperClassName = '', fieldOverrides, ...props
}, ref) {
  const mirror = useRef<HTMLDivElement | null>(null);
  const field = useRef<HTMLTextAreaElement | null>(null);
  const showColors = colorColons && !!value;
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
        {splitReviewMemoColonColors(String(value), fieldOverrides).map((part, index) => part.colonIndex === undefined
          ? <React.Fragment key={index}>{part.text}</React.Fragment>
          : <span key={index} data-colon-index={part.colonIndex + 1} style={{ color: getReviewMemoColonColor(part.colonIndex, dark) }}>{part.text}</span>)}
        {'\u200b'}
      </div>
    )}
  </div>;
});
