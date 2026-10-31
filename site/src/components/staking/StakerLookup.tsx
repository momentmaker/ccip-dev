import { useState } from 'react';
import { isAddress, stakerPath } from '../../lib/staker';

/** An address box that opens that staker's card. */
export default function StakerLookup({ label = 'Find a staker' }: { label?: string }) {
  const [value, setValue] = useState('');
  const [bad, setBad] = useState(false);
  return (
    <form
      className="lookup"
      onSubmit={(e) => {
        e.preventDefault();
        if (!isAddress(value)) {
          setBad(true);
          return;
        }
        window.location.assign(stakerPath(value));
      }}
    >
      <label htmlFor="staker-address">{label}</label>
      <div className="lookup-row">
        <input
          id="staker-address"
          className="mono"
          placeholder="0x… staking address"
          autoComplete="off"
          spellCheck={false}
          value={value}
          aria-invalid={bad}
          onChange={(e) => {
            setValue(e.target.value);
            setBad(false);
          }}
        />
        <button type="submit">Show card</button>
      </div>
      {bad && <p className="lookup-error" role="alert">That isn't an Ethereum address (0x and 40 hex characters).</p>}
    </form>
  );
}
