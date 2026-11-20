import { Fragment } from 'react';
import { FootnoteEntry } from '../lib/bookTypes';
import { toPersianDigits } from '../lib/formatParsers';

interface RichTextProps {
  text: string;
  footnoteMap?: Map<number, FootnoteEntry>;
  onSelectFootnote?: (fn: FootnoteEntry) => void;
}

export function RichText({ text, footnoteMap, onSelectFootnote }: RichTextProps) {
  const tokenRx = /(\*\*[^*]+\*\*|\[\[\d+\]\]\(#footnote-\d+\)|`[^`]+`)/g;
  const parts = text.split(tokenRx).filter(Boolean);

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
              className="mx-0.5 inline-block align-super text-[11px] font-bold text-[#1E3A5F] hover:underline"
            >
              [{toPersianDigits(fnId)}]
            </button>
          );
        }

        if (seg.startsWith('**') && seg.endsWith('**') && seg.length > 4) {
          return (
            <strong key={idx} className="font-bold text-[#1A1816]">
              {seg.slice(2, -2)}
            </strong>
          );
        }

        if (seg.startsWith('`') && seg.endsWith('`') && seg.length > 2) {
          return (
            <code
              key={idx}
              className="font-mono-ltr mx-0.5 rounded-sm bg-[#F3F0E8] px-1.5 py-0.5 text-[12px] text-[#1E3A5F]"
            >
              {seg.slice(1, -1)}
            </code>
          );
        }

        return <Fragment key={idx}>{seg}</Fragment>;
      })}
    </>
  );
}
