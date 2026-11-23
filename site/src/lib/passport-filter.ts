/** The index filters, run in the browser over the rendered rows; kept free of imports so the page ships only this. */
export interface PassportFilterRow {
  /** Symbol, name and every address, lowercased. */
  search: string;
  flagged: boolean;
}

export interface PassportFilter {
  query: string;
  flaggedOnly: boolean;
}

export function matchesPassportFilter(row: PassportFilterRow, filter: PassportFilter): boolean {
  if (filter.flaggedOnly && !row.flagged) return false;
  const query = filter.query.trim().toLowerCase();
  return query === '' || row.search.includes(query);
}

export function filterPassportRows<R extends PassportFilterRow>(rows: readonly R[], filter: PassportFilter): R[] {
  return rows.filter((r) => matchesPassportFilter(r, filter));
}
