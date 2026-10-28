const DIGITS = '0123456789';

/**
 * A number on rolling digit wheels: each digit is a column of 0–9 shifted to its value, so a change rolls instead of
 * swapping. The wheels are decorative; `label` carries the value for screen readers.
 */
export default function Odometer({ text, label, className }: { text: string; label: string; className?: string }) {
  return (
    <span className={`odo${className ? ` ${className}` : ''}`}>
      <span className="odo-wheels" aria-hidden="true">
        {[...text].map((ch, i) =>
          /\d/.test(ch) ? (
            <span key={`d${text.length - i}`} className="odo-digit">
              <span className="odo-col" style={{ transform: `translateY(${-Number(ch) * 10}%)` }}>
                {[...DIGITS].map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </span>
            </span>
          ) : (
            <span key={`s${text.length - i}`} className="odo-sep">
              {ch}
            </span>
          ),
        )}
      </span>
      <span className="visually-hidden">{label}</span>
    </span>
  );
}
