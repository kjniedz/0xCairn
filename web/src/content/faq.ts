/**
 * FAQ content. Rendered on the page and emitted as FAQPage JSON-LD at build
 * time (see vite.config.ts), so it lives in one place.
 */
export interface FaqItem {
  q: string;
  a: string;
}

export const FAQ: FaqItem[] = [
  {
    q: 'What is a vanity Ethereum address?',
    a: 'A vanity address is a normal Ethereum address whose hex characters happen to spell a pattern you chose, like 0xC0FFEE... or ...dead. It is produced by generating random private keys until one of them hashes to an address that matches. The key is as secure as any other random key; the only thing special about it is how it looks.',
  },
  {
    q: 'Does the address work on Base, Arbitrum, Polygon and other EVM chains?',
    a: 'Yes. Every EVM chain derives addresses the same way (keccak256 of the secp256k1 public key), so one private key controls the same address on Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain, Avalanche C-Chain, zkSync, Scroll, Linea, Gnosis and every other EVM-compatible network, including testnets.',
  },
  {
    q: 'Are my private keys sent anywhere?',
    a: 'No. 0xCairn runs entirely in your browser. There is no backend for generation, no analytics, no third-party scripts, and the page ships a strict Content Security Policy that forbids network connections to anything but its own static files. Once the page has loaded you can go offline and it keeps working. We recommend you do exactly that before you generate a key you intend to use.',
  },
  {
    q: 'How is this safer than the Profanity vanity generator that was exploited?',
    a: 'Profanity seeded its search from a 32-bit random value, so there were only about four billion possible starting points. Attackers brute-forced those seeds and drained wallets worth millions. 0xCairn seeds every CPU worker and every GPU batch with an independent full 256-bit scalar from crypto.getRandomValues, the browser\'s cryptographically secure generator. Walking forward from that seed by adding G is a well-understood optimisation that costs nothing in security because the starting point itself is unguessable.',
  },
  {
    q: 'How do I know the generated key really controls the address?',
    a: 'Every candidate the WASM kernel or the GPU reports is re-derived with a second, independent implementation (the audited @noble/curves and @noble/hashes libraries) before it is shown. The GPU additionally has to pass a self-test against a known key every time the page loads. If anything disagrees, the result is discarded and the engine is disabled. You can also import the key into any wallet and confirm the address yourself.',
  },
  {
    q: 'Why is it faster than other vanity address generators?',
    a: 'Three reasons. Generation runs in one Web Worker per CPU core instead of a single JavaScript thread. Elliptic-curve and keccak256 math run in a WebAssembly kernel compiled from Rust, with batched modular inversion so hundreds of points share one inverse. And when the browser supports WebGPU, a compute shader walks hundreds of thousands of points in parallel alongside the CPU workers.',
  },
  {
    q: 'What does case-sensitive matching do?',
    a: 'Ethereum addresses have an optional checksum (EIP-55) that capitalises some letters based on a hash of the address. With case-sensitive matching on, your pattern has to match the checksummed capitalisation too, so 0xCafe... and 0xCAFE... are different targets. Each letter in your pattern doubles the difficulty, digits cost nothing extra. The difficulty readout shows the exact multiplier.',
  },
  {
    q: 'How long will my pattern take?',
    a: 'Each hex character multiplies the expected work by 16. Four characters is instant, six takes seconds, eight takes minutes to hours on a laptop, and ten or more is realistically out of reach without dedicated hardware. The estimate shown above the Start button is based on a benchmark of your actual device, and the live probability readout tells you the odds that you would have found a match by now.',
  },
  {
    q: 'What is the encrypted keystore download?',
    a: 'It is a standard Web3 Secret Storage (V3) JSON file: your private key encrypted with a password using scrypt and AES-128-CTR, the same format geth, MetaMask, MyEtherWallet, Rabby and most other wallets import. Choose a strong password; the file is only as safe as the password protecting it.',
  },
  {
    q: 'What is CREATE2 mode?',
    a: 'Smart contracts deployed with CREATE2 get an address determined by the deployer address, a 32-byte salt and the hash of the contract\'s init code. CREATE2 mode mines the salt so your contract lands on a vanity address. Paste your deployer (factory) address and the init code hash, and deploy with the salt we find.',
  },
  {
    q: 'What is split-key mining?',
    a: 'It lets someone with a big GPU mine a vanity address for you without ever learning your private key. You generate a keypair locally and share only the public key. The miner searches for an offset that makes public key + offset*G land on your pattern and sends the offset back. You add the offset to your private key locally, and only you ever hold the result.',
  },
  {
    q: 'Can I verify the code?',
    a: 'Yes. 0xCairn is open source. The Rust kernel, the WGSL shader, the verification layer and the build pipeline are all in the repository linked at the top and bottom of this page, and the deployed files are the unmodified output of that build.',
  },
];
