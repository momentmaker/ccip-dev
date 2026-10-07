import { useState } from 'react';
import { nearestMark } from '../../lib/controls';

export default function Scrubber(props: {
  length: number;
  time: number;
  onScrub: (t: number) => void;
  marks: readonly { time: number; label: string; day: string }[];
  ticks: readonly { time: number; label: string }[];
  valueText: string;
  disabled?: boolean;
}) {
  const [hover, setHover] = useState(-1);
  const pct = (t: number) => `${(100 * Math.min(Math.max(t, 0), props.length)) / props.length}%`;
  return (
    <div
      className="scrubber"
      onPointerMove={(e) => {
        if (e.pointerType !== 'mouse') return;
        const rect = e.currentTarget.getBoundingClientRect();
        setHover(nearestMark(props.marks, ((e.clientX - rect.left) / rect.width) * props.length, props.length));
      }}
      onPointerLeave={() => setHover(-1)}
    >
      <div className="scrub-rail" aria-hidden="true">
        <div className="scrub-fill" style={{ width: pct(props.time) }} />
        {props.marks.map((m) => <span key={`${m.time}-${m.label}`} className="scrub-mark" style={{ left: pct(m.time) }} />)}
        {props.ticks.map((t) => <span key={t.label} className="scrub-tick" style={{ left: pct(t.time) }}>{t.label}</span>)}
        {hover >= 0 && (
          <span className="scrub-tip" style={{ left: pct(props.marks[hover]!.time) }}>
            {props.marks[hover]!.label} <span className="m">· {props.marks[hover]!.day}</span>
          </span>
        )}
      </div>
      <input
        type="range"
        min={0}
        max={props.length}
        step={0.1}
        value={Math.min(props.time, props.length)}
        aria-label="Position"
        aria-valuetext={props.valueText}
        disabled={props.disabled}
        onChange={(e) => props.onScrub(Number(e.target.value))}
      />
    </div>
  );
}
