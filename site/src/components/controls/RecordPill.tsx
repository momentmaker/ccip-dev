export default function RecordPill(props: { progress: number; onCancel: () => void }) {
  const percent = Math.round(props.progress * 100);
  return (
    <span className="rec-pill">
      <span className="rec-prog" style={{ width: `${percent}%` }} />
      <span className="rec-dot" aria-hidden="true" />
      <span role="progressbar" aria-label="Recording" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        {`Recording · ${percent}%`}
      </span>
      <button type="button" className="rec-cancel" onClick={props.onCancel}>
        Cancel
      </button>
    </span>
  );
}
