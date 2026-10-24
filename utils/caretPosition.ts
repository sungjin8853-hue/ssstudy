const MIRRORED_STYLES = [
  'direction', 'boxSizing', 'width', 'overflowX', 'overflowY',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderStyle',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize', 'lineHeight', 'fontFamily',
  'textAlign', 'textTransform', 'textIndent', 'letterSpacing', 'wordSpacing', 'tabSize', 'wordBreak'
] as const;

export interface CaretPosition {
  /** 입력칸 왼쪽 위 모서리에서 커서까지(px) */
  left: number;
  top: number;
  /** 커서가 있는 글줄의 높이(px) */
  height: number;
}

/**
 * textarea 글의 각 줄(`\n`으로 나눈 줄)이 시작하는 높이(입력칸 위 모서리에서, px)와 글줄 높이. 줄이 길어 접혀도 맞는다.
 * `caretPositionIn`과 같은 복사본 방법이지만 줄마다 따로 재지 않고 한 번에 잰다.
 */
export const lineTopsIn = (field: HTMLTextAreaElement): { tops: number[]; lineHeight: number } => {
  const owner = field.ownerDocument;
  const style = owner.defaultView!.getComputedStyle(field);
  const mirror = owner.createElement('div');
  const target = mirror.style as unknown as Record<string, string>;
  MIRRORED_STYLES.forEach(name => { target[name] = (style as unknown as Record<string, string>)[name]; });
  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.top = '0';
  mirror.style.left = '-9999px';
  mirror.style.height = 'auto';
  mirror.style.overflow = 'hidden';
  const rows = field.value.split('\n').map(line => {
    const row = owner.createElement('div');
    row.style.whiteSpace = 'pre-wrap';
    row.style.overflowWrap = 'break-word';
    row.textContent = line || '\u200b';
    mirror.appendChild(row);
    return row;
  });
  owner.body.appendChild(mirror);
  const fontSize = parseFloat(style.fontSize) || 16;
  const tops = rows.map(row => row.offsetTop - field.scrollTop);
  owner.body.removeChild(mirror);
  return { tops, lineHeight: parseFloat(style.lineHeight) || fontSize * 1.4 };
};

/**
 * textarea 안에서 커서(글자 자리)의 위치. 같은 글꼴·너비로 보이지 않는 복사본을 만들어 커서 자리의 표시를 재는 방법이라,
 * 글이 줄바꿈되어도 맞는다. 코드 편집기처럼 커서 바로 아래에 자동완성 목록을 띄울 때 쓴다.
 */
export const caretPositionIn = (field: HTMLTextAreaElement, position: number): CaretPosition => {
  const owner = field.ownerDocument;
  const style = owner.defaultView!.getComputedStyle(field);
  const mirror = owner.createElement('div');
  const target = mirror.style as unknown as Record<string, string>;
  MIRRORED_STYLES.forEach(name => { target[name] = (style as unknown as Record<string, string>)[name]; });
  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.top = '0';
  mirror.style.left = '-9999px';
  mirror.style.height = 'auto';
  mirror.style.overflow = 'hidden';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.overflowWrap = 'break-word';
  mirror.textContent = field.value.slice(0, position);
  const marker = owner.createElement('span');
  marker.textContent = field.value.slice(position) || '.';
  mirror.appendChild(marker);
  owner.body.appendChild(mirror);
  const fontSize = parseFloat(style.fontSize) || 16;
  const height = parseFloat(style.lineHeight) || fontSize * 1.4;
  const result = { left: marker.offsetLeft - field.scrollLeft, top: marker.offsetTop - field.scrollTop, height };
  owner.body.removeChild(mirror);
  return result;
};
