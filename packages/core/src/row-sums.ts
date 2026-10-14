export interface RowSums {
  messages: number;
  usd: number;
  fee: number;
  anyFee: boolean;
}

export const emptyRowSums = (): RowSums => ({ messages: 0, usd: 0, fee: 0, anyFee: false });

export function addRowSums(sums: RowSums, row: { messages: number; usd_value: number; fee_usd: number | null }): void {
  sums.messages += row.messages;
  sums.usd += row.usd_value;
  if (row.fee_usd !== null) {
    sums.fee += row.fee_usd;
    sums.anyFee = true;
  }
}
