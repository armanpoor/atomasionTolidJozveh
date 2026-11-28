import { Fragment } from 'react';
import { FootnoteEntry } from '../lib/bookTypes';
import { segmentBidiTechnicalRuns } from '../lib/ecuTechnicalIntegrity';
import { toPersianDigits } from '../lib/formatParsers';

interface RichTextProps {
  text: string;
  footnoteMap?: Map<number, FootnoteEntry>;
  onSelectFootnote?: (fn: FootnoteEntry) => void;
}

function renderBidiRuns(chunk: string, keyPrefix: string) {
  const segments = segmentBidiTechnicalRuns(chunk);
  return segments.map((part, pIdx) => {
    const key = `${keyPrefix}-${pIdx}`;
    if (part.kind === 'ltr_code') {
      return (
        <code
          key={key}
          dir="ltr"
          className="mx-0.5 inline-block rounded border border-[#D4E0EE] bg-[#EEF3F8] px-1.5 py-0.5 font-mono text-[0.86em] font-semibold leading-none text-[#1E3A5F] align-baseline"
        >
          {part.text}
        </code>
      );
    }
    if (part.kind === 'ltr_tech') {
      return (
        <span
          key={key}
          dir="ltr"
          className="inline-block font-medium text-[#1E3A5F] tabular-nums"
        >
          {part.text}
        </span>
      );
    }
    return <Fragment key={key}>{part.text}</Fragment>;
  });
}

export function RichText({ text, footnoteMap, onSelectFootnote }: RichTextProps) {
  const safeText = typeof text === 'string' ? text : '';
  if (!safeText) return null;
  const tokenRx = /(\*\*[^*]+\*\*|\[\[\d+\]\]\(#footnote-\d+\)|`[^`]+`)/g;
  const parts = safeText.split(tokenRx).filter(Boolean);

  return (
    <>
      {parts.map((seg, idx) => {
        const fnMatch = seg.match(/^\[\[(\d+)\]\]\(#footnote-\d+\)$/);
        if (fnMatch) {
          const fnId = Number(fnMatch[1]);
          const entry = footnoteMap?.get(fnId);
          return (
            <button
              key={idx}
              type="button"
              onClick={() => entry && onSelectFootnote?.(entry)}
              title={entry ? entry.text : `پانویس ${toPersianDigits(fnId)}`}
              className="mx-0.5 inline-block align-super text-[11px] font-bold text-[#1E3A5F] hover:underline cursor-pointer"
            >
              [{toPersianDigits(fnId)}]
            </button>
          );
        }

        if (seg.startsWith('**') && seg.endsWith('**') && seg.length > 4) {
          return (
            <strong key={idx} className="font-bold text-[#1A1816]">
              {renderBidiRuns(seg.slice(2, -2), `b-${idx}`)}
            </strong>
          );
        }

        if (seg.startsWith('`') && seg.endsWith('`') && seg.length > 2) {
          return (
            <code
              key={idx}
              dir="ltr"
              className="mx-0.5 inline-block rounded border border-[#D4E0EE] bg-[#EEF3F8] px-1.5 py-0.5 font-mono text-[0.86em] font-semibold leading-none text-[#1E3A5F]"
            >
              {seg.slice(1, -1)}
            </code>
          );
        }

        return <Fragment key={idx}>{renderBidiRuns(seg, `t-${idx}`)}</Fragment>;
      })}
    </>
  );
}

