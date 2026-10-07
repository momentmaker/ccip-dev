import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { moveIndex } from '../../lib/controls';

export interface SegOption<T extends string | number> {
  value: T;
  label: ReactNode;
  title?: string;
}

export default function Segmented<T extends string | number>(props: {
  label: string;
  options: readonly SegOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = props.options.findIndex((o) => o.value === props.value);
  const onKey = (e: KeyboardEvent) => {
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (delta === 0 || props.disabled) return;
    e.preventDefault();
    const next = moveIndex(index, delta, props.options.length);
    props.onChange(props.options[next]!.value);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={props.label} className={`seg ${props.className ?? ''}`} onKeyDown={onKey}>
      {props.options.map((o, i) => (
        <button
          key={String(o.value)}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={o.value === props.value}
          tabIndex={o.value === props.value ? 0 : -1}
          title={o.title}
          disabled={props.disabled}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
