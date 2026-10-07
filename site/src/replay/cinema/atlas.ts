export function atlasLayout(count: number, cell: number, maxSize = 2048) {
  const cols = Math.max(1, Math.min(count, Math.floor(maxSize / cell)));
  const rows = Math.max(1, Math.ceil(count / cols));
  const width = cols * cell;
  const height = rows * cell;
  return {
    cols,
    rows,
    width,
    height,
    cell,
    uv(i: number): [number, number, number, number] {
      const c = i % cols;
      const r = Math.floor(i / cols);
      return [(c * cell) / width, (r * cell) / height, ((c + 1) * cell) / width, ((r + 1) * cell) / height];
    },
  };
}
