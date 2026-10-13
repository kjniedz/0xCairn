/**
 * Chain module interface. EVM is the only implementation today; Solana and
 * TRON will plug in here (different key derivation, address encoding and
 * valid character sets) without touching the UI or the hexspeak finder.
 */
export interface ChainModule {
  id: 'evm' | 'solana' | 'tron';
  name: string;
  /** Characters a pattern may contain, lowercase where case-insensitive. */
  alphabet: string;
  /** Whether letter case carries meaning for matching (EIP-55 for EVM is opt-in). */
  caseSensitiveOptional: boolean;
  /** Visible address length in characters (40 for EVM hex). */
  addressLength: number;
  /** Prefix shown before the address (e.g. "0x"). */
  displayPrefix: string;
  /** Expected attempts per match for a pattern of n fixed characters. */
  difficultyForLength(n: number): number;
  /** Normalise user input: strip prefix, remove invalid chars, clamp length. */
  cleanInput(raw: string): string;
  /** Map a letter in a word to a chain-valid character, or null if impossible. */
  substitutions: Record<string, string[]>;
  /** Derive the lowercase address from a private key (independent reference implementation). */
  privateKeyToAddress(key: Uint8Array): string;
  /** Checksummed/display form of an address. */
  display(address: string): string;
}
