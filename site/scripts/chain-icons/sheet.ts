export interface SheetRow {
  file: string;
  displayName: string;
  slug: string | null;
  rule: string;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function contactSheet(rows: readonly SheetRow[]): string {
  const cells = rows
    .map(
      (r) =>
        `<figure><img src="public/chains/${escapeHtml(r.file)}" width="40" height="40"><img src="public/chains/${escapeHtml(r.file)}" width="16" height="16">` +
        `<figcaption>${escapeHtml(r.displayName)}<br><small>${escapeHtml(r.slug ?? 'lettermark')} · ${escapeHtml(r.rule)}</small></figcaption></figure>`,
    )
    .join('\n');
  return `<!doctype html><meta charset="utf-8"><title>Chain icon review</title>
<style>body{background:#0c0f14;color:#e8eaed;font:13px system-ui;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;padding:16px}figure{margin:0;display:grid;justify-items:center;gap:6px}img{border-radius:50%}small{color:#8892a0}</style>
${cells}
`;
}
