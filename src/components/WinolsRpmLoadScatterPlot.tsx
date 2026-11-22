import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { CheckCircle2, Globe } from 'lucide-react';
import { toPersianDigits } from '../lib/formatParsers';
import type {
  WinolsMapActionEntry,
  WinolsMapGoogleCoverage,
} from '../lib/winolsMapGuide';

interface WinolsRpmLoadScatterPlotProps {
  entries: WinolsMapActionEntry[];
  coverageByMapId: Record<string, WinolsMapGoogleCoverage>;
  selectedMapId: string;
  onSelectMap: (mapId: string) => void;
}

interface PlotDatum {
  entry: WinolsMapActionEntry;
  coverage: WinolsMapGoogleCoverage;
}

const CHART_WIDTH = 560;
const CHART_HEIGHT = 276;
const MARGIN = { top: 22, right: 24, bottom: 44, left: 54 };

export const WinolsRpmLoadScatterPlot: React.FC<WinolsRpmLoadScatterPlotProps> = ({
  entries,
  coverageByMapId,
  selectedMapId,
  onSelectMap,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const onSelectRef = useRef(onSelectMap);
  onSelectRef.current = onSelectMap;

  const [hoveredMapId, setHoveredMapId] = useState<string | null>(null);

  const data: PlotDatum[] = useMemo(() => {
    return entries
      .map((entry) => {
        const cov = coverageByMapId[entry.id];
        if (!cov) return null;
        return { entry, coverage: cov };
      })
      .filter((item): item is PlotDatum => item !== null);
  }, [entries, coverageByMapId]);

  const hoveredItem = useMemo(
    () => (hoveredMapId ? data.find((d) => d.entry.id === hoveredMapId) ?? null : null),
    [data, hoveredMapId]
  );

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const innerW = CHART_WIDTH - MARGIN.left - MARGIN.right;
    const innerH = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;

    const xScale = d3.scaleLinear().domain([1000, 7000]).range([0, innerW]);
    const yScale = d3.scaleLinear().domain([0, 100]).range([innerH, 0]);

    const root = svg
      .append('g')
      .attr('transform', `translate(${MARGIN.left},${MARGIN.top})`);

    // Subtle warm plot background
    root
      .append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', innerW)
      .attr('height', innerH)
      .attr('rx', 6)
      .attr('fill', '#FCFBF8')
      .attr('stroke', '#E2DDD3')
      .attr('stroke-width', 1);

    // Calibration Gridlines (X = RPM every 1000, Y = Load every 25%)
    const rpmTicks = [1000, 2000, 3000, 4000, 5000, 6000, 7000];
    const loadTicks = [0, 25, 50, 75, 100];

    root
      .append('g')
      .attr('class', 'grid-x')
      .selectAll('line')
      .data(rpmTicks)
      .join('line')
      .attr('x1', (d) => xScale(d))
      .attr('x2', (d) => xScale(d))
      .attr('y1', 0)
      .attr('y2', innerH)
      .attr('stroke', '#EAE5DB')
      .attr('stroke-dasharray', '3,3')
      .attr('stroke-width', 1);

    root
      .append('g')
      .attr('class', 'grid-y')
      .selectAll('line')
      .data(loadTicks)
      .join('line')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', (d) => yScale(d))
      .attr('y2', (d) => yScale(d))
      .attr('stroke', '#EAE5DB')
      .attr('stroke-dasharray', '3,3')
      .attr('stroke-width', 1);

    // WOT High-Load Reference Zone highlight (>75% load)
    root
      .append('rect')
      .attr('x', 0)
      .attr('y', yScale(100))
      .attr('width', innerW)
      .attr('height', yScale(75) - yScale(100))
      .attr('fill', '#1E3A5F')
      .attr('fill-opacity', 0.035);

    root
      .append('text')
      .attr('x', 8)
      .attr('y', yScale(94))
      .attr('text-anchor', 'start')
      .attr('font-size', 9.5)
      .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
      .attr('fill', '#94A3B8')
      .text('WOT / High Load');

    // D3 X-Axis (RPM)
    const xAxis = d3
      .axisBottom(xScale)
      .tickValues(rpmTicks)
      .tickFormat((d) => `${d}`)
      .tickSizeOuter(0);

    const xAxisG = root
      .append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(xAxis);

    xAxisG.select('.domain').attr('stroke', '#C8C1B4');
    xAxisG.selectAll('.tick line').attr('stroke', '#C8C1B4');
    xAxisG
      .selectAll('.tick text')
      .attr('fill', '#57534E')
      .attr('font-size', 10.5)
      .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace');

    // X-Axis Label
    root
      .append('text')
      .attr('x', innerW / 2)
      .attr('y', innerH + 34)
      .attr('direction', 'rtl')
      .attr('text-anchor', 'middle')
      .attr('font-size', 11)
      .attr('font-weight', 700)
      .attr('fill', '#1E3A5F')
      .text('دور موتور (RPM)');

    // D3 Y-Axis (Load %)
    const yAxis = d3
      .axisLeft(yScale)
      .tickValues(loadTicks)
      .tickFormat((d) => `${d}%`)
      .tickSizeOuter(0);

    const yAxisG = root.append('g').call(yAxis);
    yAxisG.select('.domain').attr('stroke', '#C8C1B4');
    yAxisG.selectAll('.tick line').attr('stroke', '#C8C1B4');
    yAxisG
      .selectAll('.tick text')
      .attr('fill', '#57534E')
      .attr('font-size', 10.5)
      .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace');

    // Y-Axis Label
    root
      .append('text')
      .attr('transform', 'rotate(-90)')
      .attr('x', -innerH / 2)
      .attr('y', -40)
      .attr('direction', 'rtl')
      .attr('text-anchor', 'middle')
      .attr('font-size', 11)
      .attr('font-weight', 700)
      .attr('fill', '#1E3A5F')
      .text('بار موتور (Load %)');

    // Operating Range Rectangles behind Scatter Points
    const rangeGroup = root.append('g').attr('class', 'operating-envelopes');
    rangeGroup
      .selectAll('rect.map-envelope')
      .data(data, (d: unknown) => (d as PlotDatum).entry.id)
      .join('rect')
      .attr('class', 'map-envelope')
      .attr('x', (d) => xScale(d.coverage.plotRpmMin))
      .attr('y', (d) => yScale(d.coverage.plotLoadMax))
      .attr('width', (d) => Math.max(12, xScale(d.coverage.plotRpmMax) - xScale(d.coverage.plotRpmMin)))
      .attr('height', (d) => Math.max(12, yScale(d.coverage.plotLoadMin) - yScale(d.coverage.plotLoadMax)))
      .attr('rx', 5)
      .attr('fill', (d) => (d.coverage.hasGoogleEnrichment ? '#15803D' : '#64748B'))
      .attr('fill-opacity', (d) =>
        d.entry.id === selectedMapId
          ? d.coverage.hasGoogleEnrichment
            ? 0.2
            : 0.16
          : d.coverage.hasGoogleEnrichment
            ? 0.1
            : 0.07
      )
      .attr('stroke', (d) =>
        d.entry.id === selectedMapId
          ? '#1E3A5F'
          : d.coverage.hasGoogleEnrichment
            ? '#15803D'
            : '#94A3B8'
      )
      .attr('stroke-width', (d) => (d.entry.id === selectedMapId ? 1.8 : 1.1))
      .attr('stroke-dasharray', (d) => (d.coverage.hasGoogleEnrichment ? 'none' : '4,3'))
      .style('cursor', 'pointer')
      .on('mouseenter', (_event, d) => setHoveredMapId(d.entry.id))
      .on('mouseleave', () => setHoveredMapId(null))
      .on('click', (_event, d) => onSelectRef.current(d.entry.id));

    // Scatter Points + Map Code Badges (D3 data join)
    const pointsGroup = root.append('g').attr('class', 'scatter-points');
    const pointNodes = pointsGroup
      .selectAll('g.scatter-node')
      .data(data, (d: unknown) => (d as PlotDatum).entry.id)
      .join('g')
      .attr('class', 'scatter-node')
      .attr('data-map-code', (d) => d.entry.mapCode)
      .attr('data-google-enriched', (d) => String(d.coverage.hasGoogleEnrichment))
      .attr(
        'transform',
        (d) =>
          `translate(${xScale(d.coverage.plotRpmCenter)},${yScale(d.coverage.plotLoadCenter)})`
      )
      .style('cursor', 'pointer')
      .on('mouseenter', (_event, d) => setHoveredMapId(d.entry.id))
      .on('mouseleave', () => setHoveredMapId(null))
      .on('click', (_event, d) => onSelectRef.current(d.entry.id));

    // Selection Halo Ring (decorative only — never block clicks on adjacent scatter points)
    pointNodes
      .filter((d) => d.entry.id === selectedMapId)
      .append('circle')
      .attr('r', 13)
      .attr('fill', 'none')
      .attr('stroke', '#1E3A5F')
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '3,2')
      .attr('pointer-events', 'none');

    // Main Scatter Circle
    pointNodes
      .append('circle')
      .attr('r', (d) => (d.entry.id === selectedMapId ? 8.5 : 7))
      .attr('fill', (d) => (d.coverage.hasGoogleEnrichment ? '#15803D' : '#FFFFFF'))
      .attr('stroke', (d) => (d.coverage.hasGoogleEnrichment ? '#14532D' : '#475569'))
      .attr('stroke-width', 2.2);

    // Inner checkmark for Google-enriched points (crisp visual distinction even for color-blind users)
    pointNodes
      .filter((d) => d.coverage.hasGoogleEnrichment)
      .append('path')
      .attr('d', 'M-3,0.2 L-1,2.4 L3.2,-2.2')
      .attr('fill', 'none')
      .attr('stroke', '#FFFFFF')
      .attr('stroke-width', 1.8)
      .attr('stroke-linecap', 'round')
      .attr('stroke-linejoin', 'round');

    // Deterministic label placement with greedy bounding-box collision avoidance
    const placedBoxes: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    const overlapsAny = (box: { x1: number; y1: number; x2: number; y2: number }) =>
      placedBoxes.some(
        (b) => !(box.x2 + 4 < b.x1 || box.x1 - 4 > b.x2 || box.y2 + 3 < b.y1 || box.y1 - 3 > b.y2)
      );

    pointNodes.each(function (d) {
      const g = d3.select(this);
      const label = d.entry.mapCode;
      const pillW = Math.max(44, label.length * 6.8 + 12);
      const pillH = 17;
      const cx = xScale(d.coverage.plotRpmCenter);
      const cy = yScale(d.coverage.plotLoadCenter);

      // Candidate local offsets (dx, dy) around the scatter circle
      const candidates: Array<{ dx: number; dy: number }> = [
        { dx: 0, dy: -28 }, // top-center
        { dx: 0, dy: 15 }, // bottom-center
        { dx: -pillW / 2 - 14, dy: -8 }, // left
        { dx: pillW / 2 + 14, dy: -8 }, // right
        { dx: -pillW / 2 - 6, dy: -28 }, // top-left
        { dx: pillW / 2 + 6, dy: 16 }, // bottom-right
        { dx: -pillW / 2 - 6, dy: 16 }, // bottom-left
        { dx: pillW / 2 + 6, dy: -28 }, // top-right
      ];

      let chosen = candidates[0];
      for (const cand of candidates) {
        const x1 = cx + cand.dx - pillW / 2;
        const x2 = x1 + pillW;
        const y1 = cy + cand.dy;
        const y2 = y1 + pillH;
        const inBounds = x1 >= 2 && x2 <= innerW - 2 && y1 >= 2 && y2 <= innerH - 2;
        if (inBounds && !overlapsAny({ x1, y1, x2, y2 })) {
          chosen = cand;
          break;
        }
      }

      const clampedDx = Math.min(
        innerW - 2 - pillW / 2 - cx,
        Math.max(2 + pillW / 2 - cx, chosen.dx)
      );
      const clampedDy = Math.min(innerH - 2 - pillH - cy, Math.max(2 - cy, chosen.dy));

      placedBoxes.push({
        x1: cx + clampedDx - pillW / 2,
        y1: cy + clampedDy,
        x2: cx + clampedDx + pillW / 2,
        y2: cy + clampedDy + pillH,
      });

      // Subtle leader line if label was offset away from default top/bottom
      if (Math.abs(clampedDx) > 10) {
        g.append('line')
          .attr('x1', 0)
          .attr('y1', 0)
          .attr('x2', clampedDx * 0.65)
          .attr('y2', clampedDy + pillH / 2)
          .attr('stroke', d.coverage.hasGoogleEnrichment ? '#86EFAC' : '#CBD5E1')
          .attr('stroke-width', 1);
      }

      g.append('rect')
        .attr('x', -pillW / 2 + clampedDx)
        .attr('y', clampedDy)
        .attr('width', pillW)
        .attr('height', pillH)
        .attr('rx', 4)
        .attr('fill', d.coverage.hasGoogleEnrichment ? '#ECFDF5' : '#FFFFFF')
        .attr(
          'stroke',
          d.entry.id === selectedMapId
            ? '#1E3A5F'
            : d.coverage.hasGoogleEnrichment
              ? '#86EFAC'
              : '#CBD5E1'
        )
        .attr('stroke-width', d.entry.id === selectedMapId ? 1.5 : 1);

      g.append('text')
        .attr('x', clampedDx)
        .attr('y', clampedDy + 11.8)
        .attr('text-anchor', 'middle')
        .attr('font-size', 10)
        .attr('font-weight', 800)
        .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
        .attr('fill', d.coverage.hasGoogleEnrichment ? '#14532D' : '#334155')
        .text(label);
    });
  }, [data, selectedMapId]);

  return (
    <div className="space-y-2">
      <div dir="ltr" className="relative w-full overflow-x-auto rounded-md border border-[#E2DDD3] bg-white p-2">
        <svg
          ref={svgRef}
          direction="ltr"
          data-testid="winols-d3-scatter-plot"
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          role="img"
          aria-label="نمودار پراکندگی D3 نقشه‌های WinOLS بر حسب دور موتور RPM و بار موتور Load"
          className="w-full h-auto max-h-[280px] select-none"
        />

        {hoveredItem && (
          <div
            dir="rtl"
            className="pointer-events-none absolute top-3 left-3 z-10 max-w-[230px] rounded-lg border border-[#D8D2C5] bg-white/95 px-3 py-2 shadow-md text-[11px] space-y-1"
          >
            <div className="flex items-center justify-between gap-2">
              <span dir="ltr" className="font-mono font-extrabold text-[#1E3A5F]">
                {hoveredItem.entry.mapCode}
              </span>
              {hoveredItem.coverage.hasGoogleEnrichment ? (
                <span className="inline-flex items-center gap-1 rounded-sm bg-[#DCFCE7] px-1.5 py-0.5 text-[10px] font-bold text-[#14532D]">
                  <CheckCircle2 className="h-3 w-3" />
                  تکمیل‌شده با گوگل
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-sm bg-[#F1F5F9] px-1.5 py-0.5 text-[10px] font-bold text-[#475569]">
                  فقط منبع فایل
                </span>
              )}
            </div>
            <div className="font-bold text-[#1A1816]">{hoveredItem.entry.mapNameFa}</div>
            <div className="text-[10.5px] text-[#57534E] tabular-nums">
              محدوده:{' '}
              <span dir="ltr" className="font-mono text-[#1A1816]">
                {hoveredItem.coverage.plotRpmMin}–{hoveredItem.coverage.plotRpmMax} RPM ·{' '}
                {hoveredItem.coverage.plotLoadMin}–{hoveredItem.coverage.plotLoadMax}% Load
              </span>
            </div>
            {hoveredItem.coverage.hasGoogleEnrichment && (
              <div className="flex items-center gap-1 text-[10px] text-[#14532D]">
                <Globe className="h-3 w-3 shrink-0" />
                <span>
                  فصل {hoveredItem.coverage.matchedChapterNumbers.map(toPersianDigits).join('، ')}
                  {hoveredItem.coverage.webSourcesCount > 0
                    ? ` · ${toPersianDigits(hoveredItem.coverage.webSourcesCount)} منبع معتبر`
                    : ''}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[10.5px] text-[#57534E]">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 font-semibold text-[#14532D]">
            <span className="inline-block h-3 w-3 rounded-full bg-[#15803D] border border-[#14532D]" />
            تکمیل‌شده با جستجوی گوگل در فایل ورد
          </span>
          <span className="inline-flex items-center gap-1.5 font-semibold text-[#475569]">
            <span className="inline-block h-3 w-3 rounded-full bg-white border-2 border-[#475569]" />
            فقط منبع جزوه ورودی (بدون توضیح گوگل)
          </span>
        </div>
        <span className="text-[10px] text-[#78716C]">
          روی هر نقطه کلیک کنید تا جدول ۲بعدی آن نقشه باز شود
        </span>
      </div>
    </div>
  );
};
