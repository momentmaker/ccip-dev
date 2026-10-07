import { chordDirected, ribbonArrow, type Chord, type ChordGroup, type ChordSubgroup } from 'd3-chord';
import { arc } from 'd3-shape';
import { useMemo, useState } from 'react';
import type { FlowData } from '../lib/flow';
import { formatCount, formatUsd } from '../lib/format';

const SIZE = 640;
const OUTER = SIZE / 2 - 90;
const INNER = OUTER - 14;

const groupColor = (key: string, i: number) => (key === 'other' ? '#4b5563' : `hsl(${218 + ((i * 7) % 24)} 78% ${46 + ((i * 11) % 26)}%)`);

export default function FlowChord({ data }: { data: FlowData }) {
  const [metric, setMetric] = useState<'usd' | 'messages'>('usd');
  const [focus, setFocus] = useState<number | null>(null);
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
      <svg viewBox={`${-SIZE / 2} ${-SIZE / 2} ${SIZE} ${SIZE}`} role="img" aria-label="Flows between CCIP chains" onPointerLeave={() => setFocus(null)}>
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
            return (
              <g key={g.index} onPointerEnter={() => setFocus(g.index)} onClick={() => setFocus((f) => (f === g.index ? null : g.index))} style={{ cursor: 'pointer' }}>
                <path d={arcPath(g) ?? ''} fill={groupColor(group.key, g.index)} />
                {g.endAngle - g.startAngle > 0.05 && (
                  <text
                    transform={`rotate(${(mid * 180) / Math.PI - 90}) translate(${OUTER + 8}) ${flip ? 'rotate(180)' : ''}`}
                    textAnchor={flip ? 'end' : 'start'}
                    dominantBaseline="middle"
                    className="flow-label"
                  >
                    {group.label}
                  </text>
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
