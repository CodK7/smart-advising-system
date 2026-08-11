import React from 'react';

/**
 * Minimal, dependency-free, XSS-safe markdown renderer for AI advisor replies.
 *
 * It builds React elements from parsed text and NEVER uses
 * dangerouslySetInnerHTML, so nothing the model emits can inject HTML or script -
 * the text is always escaped by React. It covers the constructs an LLM actually
 * produces in a chat answer: headings, bullet / numbered lists, bold, italic and
 * inline code. Anything it does not recognise falls through as plain text, so a
 * reply is never worse than the raw-text rendering this replaces.
 *
 * Direction is inherited from the parent, so it renders correctly in the Arabic
 * (RTL) layout as well - list markers use logical `ms-*` spacing.
 */

// One pass captures the inline spans we support. Order matters: the two-char
// **/__ bold markers are listed before the one-char *_ italic markers so the
// alternation prefers bold when both could match.
const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|`[^`]+`)/g;

function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  // Reset lastIndex so the module-level regex is safe to reuse across calls.
  INLINE.lastIndex = 0;
  while ((match = INLINE.exec(text)) !== null) {
    if (match.index > last) {
      nodes.push(text.slice(last, match.index));
    }
    const token = match[0];
    const key = `${keyBase}-i${i++}`;

    if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push(
        <strong key={key} className="font-semibold">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith('`')) {
      nodes.push(
        <code
          key={key}
          className="px-1 py-0.5 rounded bg-slate-100 text-[0.85em] font-mono text-[#1A365D]"
          dir="ltr"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      // Single * or _ : italic.
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    last = match.index + token.length;
  }

  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

interface Block {
  type: 'h' | 'ul' | 'ol' | 'p';
  level?: number; // heading level
  lines: string[]; // list items, or a single paragraph/heading line
}

/** Group raw lines into blocks: headings, bullet lists, numbered lists, paragraphs. */
function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: 'p', lines: [paragraph.join(' ')] });
      paragraph = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.trim() === '') {
      flushParagraph();
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({ type: 'h', level: heading[1].length, lines: [heading[2]] });
      continue;
    }

    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      flushParagraph();
      const prev = blocks[blocks.length - 1];
      if (prev && prev.type === 'ul') prev.lines.push(bullet[1]);
      else blocks.push({ type: 'ul', lines: [bullet[1]] });
      continue;
    }

    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      flushParagraph();
      const prev = blocks[blocks.length - 1];
      if (prev && prev.type === 'ol') prev.lines.push(numbered[1]);
      else blocks.push({ type: 'ol', lines: [numbered[1]] });
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  return blocks;
}

export default function Markdown({ text }: { text: string }) {
  const blocks = parseBlocks(text ?? '');

  return (
    <div className="space-y-2 leading-relaxed text-sm">
      {blocks.map((block, bi) => {
        const key = `b${bi}`;
        switch (block.type) {
          case 'h': {
            const size =
              block.level === 1 ? 'text-base' : block.level === 2 ? 'text-sm' : 'text-sm';
            return (
              <p key={key} className={`font-bold text-[#1A365D] ${size}`}>
                {renderInline(block.lines[0], key)}
              </p>
            );
          }
          case 'ul':
            return (
              <ul key={key} className="list-disc list-inside space-y-1 ms-1">
                {block.lines.map((li, li_i) => (
                  <li key={`${key}-${li_i}`}>{renderInline(li, `${key}-${li_i}`)}</li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={key} className="list-decimal list-inside space-y-1 ms-1">
                {block.lines.map((li, li_i) => (
                  <li key={`${key}-${li_i}`}>{renderInline(li, `${key}-${li_i}`)}</li>
                ))}
              </ol>
            );
          default:
            return <p key={key}>{renderInline(block.lines[0], key)}</p>;
        }
      })}
    </div>
  );
}
