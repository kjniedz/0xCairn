/**
 * Long-form guides rendered as static pages at /guides/<slug>/. Plain
 * paragraphs and headings; no scripts on those pages.
 */
export interface Guide {
  slug: string;
  title: string;
  description: string;
  /** Blocks: strings are paragraphs; { h: '...' } are h2 headings; { li: [...] } lists. */
  body: Array<string | { h: string } | { li: string[] }>;
}

export const GUIDES: Guide[] = [
  {
    slug: 'what-is-a-vanity-address',
    title: 'What is a vanity Ethereum address?',
    description: 'How vanity addresses work, why they are exactly as secure as any other address, and how long different patterns take to mine.',
    body: [
      'A vanity address is an ordinary Ethereum address whose hexadecimal characters happen to spell something you chose: a word like 0xC0FFEE, a run of zeros, your initials, or a suffix like …dead. It is produced by generating random private keys and checking the resulting address until one matches. Nothing about the key is special. It is just the one that happened to land on your pattern.',
      { h: 'How addresses are derived' },
      'An Ethereum address is the last 20 bytes of keccak256 of the uncompressed secp256k1 public key, and that public key is derived from a 256-bit private key. There is no way to run this backwards, so there is no way to choose an address and compute its key. The only option is trial and error, which is what a vanity generator automates.',
      { h: 'How hard is a pattern?' },
      'Each hex character has 16 possibilities, so every fixed character multiplies the expected number of attempts by 16. Four characters is about 65 thousand attempts, six is about 17 million, eight is about 4 billion, and ten is about a trillion. A modern laptop running 0xCairn checks tens of millions of candidates per second, so patterns up to about seven or eight characters are practical in the browser; beyond that you are into hours or days, which is what Cairn Pro exists for.',
      { h: 'Is a vanity address less secure?' },
      'No, provided the generator seeds its search with a full-size random number. The key is one of 2^256 possibilities regardless of what the address looks like. The one historical exception was the Profanity tool, which seeded its search from only 32 bits of randomness. Attackers could enumerate every possible starting point and recover keys, which led to tens of millions of dollars stolen in 2022. 0xCairn seeds every worker with 256 bits from the browser\'s cryptographic random number generator, so there is nothing to enumerate.',
      { h: 'Does it work on every chain?' },
      'Yes. Base, Arbitrum, Optimism, Polygon, BNB Chain, Avalanche C-Chain, zkSync, Scroll, Linea, Gnosis and every other EVM-compatible network derive addresses identically, so one private key controls the same vanity address everywhere.',
    ],
  },
  {
    slug: 'is-it-safe',
    title: 'Is a vanity address generator safe to use?',
    description: 'What to check before trusting any vanity address generator with a key you will fund, and how 0xCairn is built to pass those checks.',
    body: [
      'A vanity address generator produces the private key to an account you will fund. That makes it one of the highest-trust pieces of software you can run. Here is what to look for.',
      { h: 'Does it run entirely on your machine?' },
      'If a generator talks to a server during generation, the server could learn your key. 0xCairn makes no network calls while mining, serves every page with a Content Security Policy that forbids connections to anything but its own static files, and keeps working with the network switched off. Load the page, go offline, mine.',
      { h: 'Where does the randomness come from?' },
      'A generator must seed its search with at least 256 bits from a cryptographically secure source. Anything smaller can be enumerated by an attacker, which is exactly what happened with Profanity. 0xCairn uses crypto.getRandomValues for every worker and every GPU batch and never derives a key from a timestamp, a counter or a short seed.',
      { h: 'Is the result verified?' },
      'Fast mining code is complex, and a bug could show you an address that your key does not actually control. 0xCairn re-derives every candidate with an independent implementation (the audited @noble libraries) before display, and its GPU kernel has to pass a known-answer self-test every time the page loads.',
      { h: 'Can you read the code?' },
      'Open source is not a guarantee, but closed source is a guarantee that nobody has checked. 0xCairn\'s kernel, shader, verification layer and build are public under the MIT licence, and the deployed site is the unmodified build output.',
      { h: 'A short checklist for any generator' },
      { li: ['Disconnect from the internet before generating a key you will use.', 'Prefer an encrypted keystore download over copying a raw private key.', 'Import the key into your wallet and confirm the address matches before funding.', 'Send a small test amount first.', 'Never paste a private key into any website, chat or "checker".'] },
    ],
  },
  {
    slug: 'profanity-exploit',
    title: 'The Profanity exploit, and why 0xCairn is not vulnerable',
    description: 'What went wrong in the Profanity vanity address generator in 2022, how attackers recovered private keys, and the specific design choices that rule it out here.',
    body: [
      'Profanity was a popular GPU vanity address generator. In September 2022 researchers at 1inch disclosed that its private keys could be recovered, and attackers drained wallets holding tens of millions of dollars, including the Wintermute hack.',
      { h: 'The flaw' },
      'Profanity seeded its search with a 32-bit random value. From that seed it derived a starting private key and then walked forward, adding a constant to the key for every candidate it checked. Walking forward is fine. The problem is that there were only about 4.3 billion possible starting points. An attacker could regenerate every one of them, replay the same walk, and check whether any of the resulting addresses were in use. Vanity addresses stand out, so finding targets was easy.',
      { h: 'Why walking forward is still fine' },
      'Adding a constant to a private key and adding the matching point to the public key is a standard optimisation: it lets a miner check candidates with one cheap elliptic-curve addition instead of a full multiplication. The security of the resulting key depends entirely on the starting point being unguessable. With a 256-bit seed there are 2^256 starting points, which no attacker can enumerate.',
      { h: 'What 0xCairn does differently' },
      { li: ['Every CPU worker and every GPU batch starts from its own full 256-bit scalar drawn from crypto.getRandomValues, the browser\'s cryptographically secure generator.', 'Seeds are never derived from timestamps, counters, user input or anything smaller than 256 bits. The kernel refuses seeds that are zero or outside the curve order.', 'The code that does this is a few lines in the open-source kernel and the worker, so you can verify it rather than take our word.'] },
      { h: 'If you used Profanity' },
      'Any address generated with Profanity (or its forks that kept the seeding) should be treated as compromised. Move funds to a fresh address generated by a tool that seeds correctly.',
    ],
  },
  {
    slug: 'create2-vanity-contract-addresses',
    title: 'CREATE2 vanity contract addresses: how salt mining works',
    description: 'How to deploy a smart contract to a vanity address using CREATE2, why leading zeros save gas, and how salt mining finds the address before you deploy.',
    body: [
      'CREATE2 lets you know a contract\'s address before deploying it. The address depends only on the deploying factory, a 32-byte salt and the hash of the init code: keccak256(0xff ++ deployer ++ salt ++ keccak256(initCode))[12:]. Because the salt is free to choose, you can search for a salt that puts the contract on a vanity address, then deploy with that salt.',
      { h: 'Why protocols mine contract addresses' },
      { li: ['Gas: every zero byte in calldata costs 4 gas instead of 16. A contract address with several leading zero bytes is passed around constantly, so the savings compound across every user of the protocol.', 'Brand: a router at 0xBA5E… or a vault at 0x5AFE… is recognisable in explorers and wallets.', 'Uniswap v4 hooks: a hook\'s permissions are encoded in the lowest 14 bits of its address, so a hook must be deployed to an address with exactly the right bits set. That is only possible by mining the salt.'] },
      { h: 'What you need' },
      'The factory address that will execute CREATE2 (for example the deterministic deployment proxy at 0x4e59b44847b379578588920cA78FbF26c0B4956C, a Safe factory, or your own), and the exact init code: the creation bytecode with the ABI-encoded constructor arguments appended. Change a single constructor argument and the init code hash changes, which changes every address.',
      { h: 'Mining in 0xCairn' },
      'The CREATE2 tab takes the deployer and either the init code hash or the raw init code, plus a prefix, suffix or bit-mask target. The browser kernel checks millions of salts per second per core. Salts are not secret, so the result can be shared freely and verified by anyone who recomputes the formula. For long targets, Cairn for Teams runs the same search on dedicated GPUs with a REST API and CLI so it fits into a deploy script.',
      { h: 'Deploying' },
      'Call the factory with the salt and the identical init code. If the address does not match, the init code differs from what you hashed: check compiler version, optimizer settings, metadata hash and constructor arguments.',
    ],
  },
  {
    slug: 'uniswap-v4-hook-address-mining',
    title: 'Uniswap v4 hook address mining',
    description: 'Why Uniswap v4 hook contracts must live at addresses with specific flag bits, and how to mine a CREATE2 salt that satisfies them.',
    body: [
      'Uniswap v4 validates a hook\'s permissions from its address rather than from storage. The lowest 14 bits of the hook address are flags: beforeInitialize, afterInitialize, beforeAddLiquidity, afterAddLiquidity, beforeRemoveLiquidity, afterRemoveLiquidity, beforeSwap, afterSwap, beforeDonate, afterDonate, and the four return-delta flags. The PoolManager refuses to initialise a pool whose hook address does not declare exactly the permissions the hook implements.',
      { h: 'Why that means mining' },
      'You cannot pick a contract address, so the only way to get the right 14 bits is to deploy with CREATE2 and search for a salt whose resulting address has those bits. Fourteen constrained bits means about 16 thousand attempts on average, which takes a fraction of a second. Many teams also add a vanity prefix on top, which multiplies the work by 16 per character.',
      { h: 'Mining it in 0xCairn' },
      'In the CREATE2 tab, open "Advanced: bit-mask target" and toggle the permissions your hook implements. 0xCairn sets the mask to the low 14 bits and the value to your flags, forcing unselected flags to zero as v4 requires. Add the deployer and init code hash, optionally a prefix, and start. The salt it finds is verified by re-computing the CREATE2 formula with an independent implementation before it is shown.',
      { h: 'From a deploy script' },
      'Cairn for Teams exposes the same search over a REST API: submit deployer, init code hash, mask and value; poll for the salt. The CLI in the repository wraps those two calls and prints the salt as JSON.',
      { h: 'Common mistakes' },
      { li: ['Mining against the wrong init code hash (constructor arguments included) so the deployed address differs.', 'Forgetting that unselected flags must be zero: a mask over only the bits you want set is not enough.', 'Deploying through a different factory than the one used for mining.'] },
    ],
  },
];
