import type { LiveMessage } from '@ccip-dev/core/public';
import { formatUsd } from './format';
import { laneLabel, type ChainNames } from './names';

export function launchAnnouncement(names: ChainNames, message: Pick<LiveMessage, 'src' | 'dst' | 'usd' | 'cre'>): string {
  const value = message.usd ? `, ${formatUsd(message.usd)}` : '';
  const sender = message.cre ? ', sent by a CRE workflow' : '';
  return `${laneLabel(names, `${message.src}>${message.dst}`)}${value}${sender}`;
}
