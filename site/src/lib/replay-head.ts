import { formatCount, formatUtcDay } from './format';

interface HeadInput {
  focusName: string | null;
  firstDay: string | null;
  messages: number;
  chains: number;
}

const chainCount = (n: number) => `${n} ${n === 1 ? 'chain' : 'chains'}`;

export function replayHead({ focusName, firstDay, messages, chains }: HeadInput): { title: string; lead: string } {
  if (focusName && firstDay) {
    return { title: `${focusName} on Chainlink CCIP`, lead: `${formatCount(messages)} messages with ${chainCount(chains)} since ${formatUtcDay(firstDay)}` };
  }
  return { title: 'Watch CCIP grow', lead: `${formatCount(messages)} messages across ${chainCount(chains)}, replayed in 30 seconds.` };
}
