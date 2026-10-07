import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { activeAfterSearch, filterChains, moveIndex, type PickerChain } from '../../lib/controls';
import { formatUsd } from '../../lib/format';

const ALL = '__all__';

function ChainCoin({ chain, lazy = false }: { chain: PickerChain; lazy?: boolean }) {
  if (chain.icon) return <img src={chain.icon} alt="" width={26} height={26} loading={lazy ? 'lazy' : undefined} />;
  return (
    <span className="all-coin" aria-hidden="true">
      {chain.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

const allCoin = (
  <span className="all-coin" aria-hidden="true">
    ✦
  </span>
);

export default function ChainPicker(props: { chains: readonly PickerChain[]; value: string | null; onChange: (selector: string | null) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const results = useMemo(() => filterChains(query, props.chains), [query, props.chains]);
  const items = useMemo(() => [ALL, ...results.map((c) => c.selector)], [results]);
  const current = props.chains.find((c) => c.selector === props.value) ?? null;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  useEffect(() => {
    if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open, listId]);

  const choose = (key: string) => {
    props.onChange(key === ALL ? null : key);
    setOpen(false);
    setQuery('');
    buttonRef.current?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => moveIndex(a, e.key === 'ArrowDown' ? 1 : -1, items.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const key = items[active];
      if (key) choose(key);
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    }
  };

  return (
    <div
      className="chain-picker-wrap"
      ref={wrapRef}
      onBlur={(e) => {
        if (open && !wrapRef.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className={`chain-picker${open ? ' open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={props.disabled}
        onClick={() => {
          setOpen((o) => !o);
          setActive(Math.max(0, items.indexOf(props.value ?? ALL)));
        }}
      >
        {current ? <ChainCoin chain={current} /> : allCoin}
        <span>{current ? current.name : 'All chains'}</span>
        <span className="caret" aria-hidden="true" />
      </button>
      {open && (
        <div className="chain-pop">
          <input
            autoFocus
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={`${listId}-${active}`}
            aria-label="Search chains"
            placeholder={`Search ${props.chains.length} chains`}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(activeAfterSearch(e.target.value, filterChains(e.target.value, props.chains).length));
            }}
            onKeyDown={onKey}
          />
          <ul role="listbox" id={listId} aria-label="Chains">
            {items.map((key, i) => {
              const chain = key === ALL ? null : results.find((c) => c.selector === key)!;
              const selected = key === ALL ? props.value === null : props.value === key;
              return (
                <li
                  key={key}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={selected}
                  className={`${i === active ? 'active' : ''} ${selected ? 'on' : ''}`}
                  onPointerEnter={() => setActive(i)}
                  onClick={() => choose(key)}
                >
                  {chain ? <ChainCoin chain={chain} lazy /> : allCoin}
                  <span>{chain ? chain.name : 'All chains'}</span>
                  <span className="m">{chain ? formatUsd(chain.value) : 'network'}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
