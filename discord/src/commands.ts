/** The six commands, as pnpm discord:register PUTs them (discord.com/developers/docs/interactions/application-commands). */
/** Install in servers only (no user install), and run in server channels only (no DMs). */
const SERVERS_ONLY = { integration_types: [0], contexts: [0] };
const STRING = 3;
const USER = 6;

/** Bounds what a Marine can type, so the error that echoes it back always fits in a reply. */
const MAX_CHAIN_LENGTH = 64;

export const COMMANDS = [
  { name: 'enlist', description: 'Enlist: draw your permanent LinkMarine callsign and get your dog tags', type: 1, ...SERVERS_ONLY },
  { name: 'dogtag', description: "Show a Marine's dog tags", type: 1, ...SERVERS_ONLY, options: [{ type: USER, name: 'marine', description: 'Whose tags (yours if left out)', required: false }] },
  { name: 'cciptoday', description: "Today's CCIP SITREP", type: 1, ...SERVERS_ONLY },
  {
    name: 'ccipchain',
    description: "A chain's CCIP dossier",
    type: 1,
    ...SERVERS_ONLY,
    options: [{ type: STRING, name: 'chain', description: 'The chain', required: true, autocomplete: true, max_length: MAX_CHAIN_LENGTH }],
  },
  { name: 'linkreserve', description: 'The Chainlink Reserve vault', type: 1, ...SERVERS_ONLY },
  { name: 'cciprecords', description: "CCIP's hall of records", type: 1, ...SERVERS_ONLY },
] as const;

export type CommandName = (typeof COMMANDS)[number]['name'];
