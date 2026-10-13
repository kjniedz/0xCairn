import type { ChainModule } from './types';
import { privateKeyToAddress, toChecksum } from '../lib/eth';

/**
 * Letter → hex substitutions used by the hexspeak finder. First entry is the
 * most readable. Letters with no entry cannot be represented.
 */
export const EVM_SUBSTITUTIONS: Record<string, string[]> = {
  a: ['a', '4'],
  b: ['b', '8'],
  c: ['c'],
  d: ['d'],
  e: ['e', '3'],
  f: ['f'],
  g: ['9', '6'],
  i: ['1'],
  l: ['1'],
  o: ['0'],
  s: ['5'],
  t: ['7'],
  z: ['2'],
  '0': ['0'],
  '1': ['1'],
  '2': ['2'],
  '3': ['3'],
  '4': ['4'],
  '5': ['5'],
  '6': ['6'],
  '7': ['7'],
  '8': ['8'],
  '9': ['9'],
};

export const evm: ChainModule = {
  id: 'evm',
  name: 'Ethereum / EVM',
  alphabet: '0123456789abcdef',
  caseSensitiveOptional: true,
  addressLength: 40,
  displayPrefix: '0x',
  difficultyForLength: (n) => Math.pow(16, n),
  cleanInput: (raw) => raw.replace(/^0x/i, '').replace(/[^0-9a-fA-F]/g, '').slice(0, 40),
  substitutions: EVM_SUBSTITUTIONS,
  privateKeyToAddress,
  display: (a) => '0x' + toChecksum(a),
};

export const CHAINS: ChainModule[] = [evm];
export const DEFAULT_CHAIN = evm;
