import { chordDirected, ribbonArrow, type Chord, type ChordGroup, type ChordSubgroup } from 'd3-chord';
import { arc } from 'd3-shape';
import { useEffect, useMemo, useRef, useState } from 'react';
import { iconHref } from '../lib/chain-icons';
import { chordScale, labelAngle, OTHER, truncateLabel, type FlowData } from '../lib/flow';
import { formatCount, formatUsd } from '../lib/format';

const SIZE = 640;
const RING = 14;

const groupColor = (key: string, i: number) => (key === OTHER ? '#4b5563' : `hsl(${218 + ((i * 7) % 24)} 78% ${46 + ((i * 11) % 26)}%)`);

export default function FlowChord({ data }: { data: FlowData }) {
  const [metric, setMetric] = useState<'usd' | 'messages'>('usd');
  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setWidth(svg.getBoundingClientRect().width));
    observer.observe(svg);
    return () => observer.disconnect();
  }, [data.groups.length]);
  const scale = chordScale(width);
  const OUTER = SIZE / 2 - scale.margin;
  const INNER = OUTER - RING;
  const LABEL_ICON = scale.icon;
  const focus = hovered ?? selected;
  const chords = useMemo(() => chordDirected().padAngle(0.03).sortSubgroups((a, b) => b - a)(data[metric]), [data, metric]);
  const arcPath = arc<ChordGroup>().innerRadius(INNER).outerRadius(OUTER);
  const ribbon = ribbonArrow<Chord, ChordSubgroup>().radius(INNER - 1).padAngle(1 / INNER);
  const format = metric === 'usd' ? formatUsd : formatCount;
  if (data.groups.length === 0) return <p className="muted">No lane data for this window yet.</p>;
  const touches = (c: Chord) => focus === null || c.source.index === focus || c.target.index === focus;

  return (
    <div className="flow">
      <div className="tabs" role="group" aria-label="Measure">
        <button type="button" className={metric === 'usd' ? 'active' : ''} aria-pressed={metric === 'usd'} onClick={() => setMetric('usd')}>Value</button>
        <button type="button" className={metric === 'messages' ? 'active' : ''} aria-pressed={metric === 'messages'} onClick={() => setMetric('messages')}>Messages</button>
      </div>
      <svg ref={svgRef} viewBox={`${-SIZE / 2} ${-SIZE / 2} ${SIZE} ${SIZE}`} role="group" aria-label="Flows between CCIP chains" onClick={() => setSelected(null)} onPointerLeave={(e) => e.pointerType === 'mouse' && setHovered(null)}>
        <defs>
          <clipPath id="flow-icon-clip" clipPathUnits="objectBoundingBox">
            <circle cx="0.5" cy="0.5" r="0.5" />
          </clipPath>
        </defs>
        <g>
          {chords.map((c, i) => (
            <path
              key={i}
              d={ribbon(c) as unknown as string}
              fill={groupColor(data.groups[c.source.index]!.key, c.source.index)}
              fillOpacity={touches(c) ? 0.72 : 0.06}
            >
              <title>{`${data.groups[c.source.index]!.label} → ${data.groups[c.target.index]!.label}: ${format(c.source.value)}`}</title>
            </path>
          ))}
        </g>
        <g>
          {chords.groups.map((g) => {
            const mid = (g.startAngle + g.endAngle) / 2;
            const flip = mid > Math.PI;
            const group = data.groups[g.index]!;
            const href = iconHref(group.key);
            return (
              <g
                key={g.index}
                tabIndex={0}
                role="button"
                aria-label={`${group.label}: ${format(metric === 'usd' ? group.usd : group.messages)}`}
                aria-pressed={selected === g.index}
                onPointerEnter={(e) => e.pointerType === 'mouse' && setHovered(g.index)}
                onFocus={(e) => e.currentTarget.matches(':focus-visible') && setHovered(g.index)}
                onBlur={() => setHovered(null)}
                onClick={(e) => {
                  e.stopPropagation();
                  const mouse = (e.nativeEvent as PointerEvent).pointerType === 'mouse';
                  setSelected((s) => (s === g.index && !mouse ? null : g.index));
                }}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return;
                  e.preventDefault();
                  setSelected((s) => (s === g.index ? null : g.index));
                }}
                style={{ cursor: 'pointer' }}
              >
                <path d={arcPath(g) ?? ''} fill={groupColor(group.key, g.index)} />
                {g.endAngle - g.startAngle > 0.05 && (
                  <g transform={`rotate(${(mid * 180) / Math.PI - 90}) translate(${OUTER + 8}) ${flip ? 'rotate(180)' : ''}`}>
                    {href && (
                      <g transform={`translate(${flip ? -LABEL_ICON / 2 : LABEL_ICON / 2} 0) rotate(${-labelAngle(mid)})`}>
                        <image href={href} x={-LABEL_ICON / 2} y={-LABEL_ICON / 2} width={LABEL_ICON} height={LABEL_ICON} clipPath="url(#flow-icon-clip)" />
                      </g>
                    )}
                    <text x={href ? (flip ? -(LABEL_ICON + 4) : LABEL_ICON + 4) : 0} textAnchor={flip ? 'end' : 'start'} dominantBaseline="middle" className="flow-label" style={{ fontSize: scale.font }}>
                      {truncateLabel(group.label, scale.maxChars)}
                    </text>
                  </g>
                )}
                <title>{`${group.label}: ${format(metric === 'usd' ? group.usd : group.messages)}`}</title>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
