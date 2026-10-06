/** A point is an outlier when it is more than this many times above, or below, the median of its neighbours. */
const MAX_RATIO = 20;
/** Neighbours are the series' other points at most this many days away... */
const WINDOW_DAYS = 7;
/** ...unless fewer than this many are, in which case they are this many nearest other points, at any distance. */
const MIN_NEIGHBOURS = 3;
const DAY_MS = 86_400_000;

interface Point {
  day: string;
  price: number;
  dayNumber: number;
}

/**
 * Drops the glitched points of a daily price series, such as elizaOS's $125,176 launch-day print among ~$0.01 days.
 * Every point is judged against the median of its neighbours in the raw series, all in one pass: a dropped point still
 * counts as a neighbour of the others, so whether a point is kept never depends on the order the points are judged in.
 * A series with fewer than MIN_NEIGHBOURS + 1 points is kept as it is.
 */
export function dropPriceOutliers(series: Record<string, number>): { kept: Record<string, number>; dropped: string[] } {
  const points = Object.entries(series)
    .map(([day, price]) => ({ day, price, dayNumber: Date.parse(`${day}T00:00:00.000Z`) / DAY_MS }))
    .sort((a, b) => a.dayNumber - b.dayNumber);
  const dropped = new Set(points.filter((_, i) => isOutlier(points, i)).map((p) => p.day));
  return {
    kept: Object.fromEntries(Object.entries(series).filter(([day]) => !dropped.has(day))),
    dropped: [...dropped],
  };
}

function isOutlier(points: Point[], i: number): boolean {
  const neighbours = neighbourPrices(points, i);
  if (neighbours.length < MIN_NEIGHBOURS) return false;
  const m = median(neighbours);
  const price = points[i]!.price;
  return price > MAX_RATIO * m || price < m / MAX_RATIO;
}

/** `points` is sorted by day, one point per day, so the points within WINDOW_DAYS sit within WINDOW_DAYS places of i. */
function neighbourPrices(points: Point[], i: number): number[] {
  const at = points[i]!.dayNumber;
  const distance = (j: number) => Math.abs(points[j]!.dayNumber - at);
  const near: number[] = [];
  for (let j = Math.max(0, i - WINDOW_DAYS); j <= Math.min(points.length - 1, i + WINDOW_DAYS); j++) {
    if (j !== i && distance(j) <= WINDOW_DAYS) near.push(points[j]!.price);
  }
  if (near.length >= MIN_NEIGHBOURS) return near;
  const nearest: number[] = [];
  let [before, after] = [i - 1, i + 1];
  while (nearest.length < MIN_NEIGHBOURS && (before >= 0 || after < points.length)) {
    const takeBefore = after >= points.length || (before >= 0 && distance(before) <= distance(after));
    nearest.push(points[takeBefore ? before-- : after++]!.price);
  }
  return nearest;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
