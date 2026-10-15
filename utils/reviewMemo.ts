export const REVIEW_MEMO_TOGGLE_START = ':::toggle ';
export const REVIEW_MEMO_TOGGLE_END = ':::end';

export type ReviewMemoBlock =
  | { type: 'text'; text: string }
  | { type: 'toggle'; title: string; text: string };

export const parseReviewMemoBlocks = (memo: string): ReviewMemoBlock[] => {
  if (!memo) return [];
  const lines = memo.split('\n');
  const blocks: ReviewMemoBlock[] = [];
  let plainLines: string[] = [];

  const flushPlainText = () => {
    if (plainLines.length === 0) return;
    blocks.push({ type: 'text', text: plainLines.join('\n') });
    plainLines = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.startsWith(REVIEW_MEMO_TOGGLE_START)) {
      plainLines.push(line);
      continue;
    }

    let depth = 1;
    let endIndex = -1;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (lines[cursor].startsWith(REVIEW_MEMO_TOGGLE_START)) depth += 1;
      else if (lines[cursor] === REVIEW_MEMO_TOGGLE_END) depth -= 1;
      if (depth === 0) {
        endIndex = cursor;
        break;
      }
    }
    if (endIndex === -1) {
      plainLines.push(line);
      continue;
    }

    flushPlainText();
    blocks.push({
      type: 'toggle',
      title: line.slice(REVIEW_MEMO_TOGGLE_START.length),
      text: lines.slice(index + 1, endIndex).join('\n')
    });
    index = endIndex;
  }

  flushPlainText();
  return blocks;
};

export const serializeReviewMemoBlocks = (blocks: ReviewMemoBlock[]): string => (
  blocks
    .map(block => block.type === 'text'
      ? block.text
      : `${REVIEW_MEMO_TOGGLE_START}${block.title}\n${block.text}\n${REVIEW_MEMO_TOGGLE_END}`
    )
    .filter(Boolean)
    .join('\n')
);

export const getReviewMemoPlainText = (memo: string): string => (
  parseReviewMemoBlocks(memo)
    .map(block => block.type === 'text' ? block.text : `${block.title}\n${getReviewMemoPlainText(block.text)}`)
    .filter(Boolean)
    .join('\n')
);

export const unwrapReviewMemoToggle = (block: Extract<ReviewMemoBlock, { type: 'toggle' }>): ReviewMemoBlock[] => (
  [{ type: 'text', text: block.title }, ...parseReviewMemoBlocks(block.text)]
);

export const canNestReviewMemoToggle = (source: number[], target: number[]) => (
  source.length > 0 && target.length > 0
  && !(target.length >= source.length && source.every((index, depth) => target[depth] === index))
);

export const moveReviewMemoToggle = (memo: string, sourcePath: number[], targetPath: number[]): string => {
  if (!canNestReviewMemoToggle(sourcePath, targetPath)) return memo;
  type Node = { type: 'text'; text: string } | { type: 'toggle'; title: string; children: Node[] };
  const read = (text: string): Node[] => parseReviewMemoBlocks(text).map(block => (
    block.type === 'text' ? { ...block } : { type: 'toggle', title: block.title, children: read(block.text) }
  ));
  const write = (nodes: Node[]): string => serializeReviewMemoBlocks(nodes.map(node => (
    node.type === 'text' ? node : { type: 'toggle', title: node.title, text: write(node.children) }
  )));
  const nodes = read(memo);
  const locate = (path: number[]) => {
    let siblings = nodes;
    for (let depth = 0; depth < path.length; depth += 1) {
      const node = siblings[path[depth]];
      if (!node) return null;
      if (depth === path.length - 1) return { node, siblings, index: path[depth] };
      if (node.type !== 'toggle') return null;
      siblings = node.children;
    }
    return null;
  };
  const source = locate(sourcePath);
  const target = locate(targetPath);
  if (!source || !target || source.node.type !== 'toggle' || target.node.type !== 'toggle') return memo;
  // Resolve both nodes before removal; removing a sibling changes its index.
  source.siblings.splice(source.index, 1);
  target.node.children.push(source.node);
  return write(nodes);
};
