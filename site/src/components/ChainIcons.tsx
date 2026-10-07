import { iconHref } from '../lib/chain-icons';

export default function ChainIcons({ selectors, size = 16 }: { selectors: readonly string[]; size?: number }) {
  const hrefs = selectors.flatMap((s) => {
    const href = iconHref(s);
    return href ? [href] : [];
  });
  if (hrefs.length === 0) return null;
  return (
    <span className="chain-icons" aria-hidden="true">
      {hrefs.map((href, i) => (
        <img key={`${i}-${href}`} src={href} alt="" width={size} height={size} loading="lazy" decoding="async" style={i > 0 ? { marginLeft: -size / 4 } : undefined} />
      ))}
    </span>
  );
}
