export const SITE = {
  name: '0xCairn',
  tagline: 'Carve your address. Any EVM chain.',
  url: 'https://0xcairn.kyleniedz99.workers.dev',
  repo: 'https://github.com/kjniedz/0xCairn',
  description:
    'Free, open-source vanity Ethereum address generator. Pick a prefix or suffix and mine a matching address and private key entirely in your browser, across every CPU core and WebGPU. Works on Ethereum and every EVM chain.',
  /** Separate routes with their own CSP; the generator page never links scripts from them. */
  proPath: '/pro/',
  teamsPath: '/teams/',
  privacyPath: '/privacy/',
  termsPath: '/terms/',
  blackMountain: 'https://blackmountainig.com',
  /** Plain anchors only, rel="noopener sponsored". Fill in affiliate parameters when the programmes are approved. */
  affiliate: {
    ledger: 'https://shop.ledger.com/',
    trezor: 'https://trezor.io/',
  },
  /** Mined with 0xCairn. Replaced by scripts/mine-tip.mjs output. */
  tipAddress: 'ca148145d27476b0fa36718999880f3adee06ca1',
} as const;
