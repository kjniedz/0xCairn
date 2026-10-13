/**
 * Hexspeak finder: turn any word or name into valid chain alphabet spellings,
 * ranked by readability. Chain-aware via ChainModule.substitutions.
 */
import type { ChainModule } from '../chains/types';
import { HEXSPEAK_UNIQUE } from '../content/hexspeak';

export interface HexSuggestion {
  hex: string;
  /** 0..1, higher is more readable (fewer and gentler substitutions). */
  readability: number;
  /** Letters that had to be dropped because the chain alphabet cannot express them. */
  dropped: string[];
  /** Number of characters substituted (not identity). */
  substitutions: number;
  fromDictionary: boolean;
}

/** Readability cost of each substitution; identity is 0. Lower is better. */
const COST: Record<string, number> = {
  'o→0': 0.15,
  'i→1': 0.25,
  'l→1': 0.3,
  's→5': 0.35,
  'e→3': 0.5,
  'a→4': 0.6,
  't→7': 0.4,
  'z→2': 0.4,
  'g→9': 0.55,
  'g→6': 0.7,
  'b→8': 0.7,
};

export function findHexspeak(word: string, chain: ChainModule, limit = 6): HexSuggestion[] {
  const w = word.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!w) return [];
  const alphabet = new Set(chain.alphabet);
  const subs = chain.substitutions;

  // Per-letter options: identity if in alphabet, else substitution list, else drop.
  const options: Array<Array<{ ch: string; cost: number }>> = [];
  const dropped: string[] = [];
  for (const ch of w) {
    if (alphabet.has(ch)) {
      const extra = (subs[ch] ?? []).filter((s) => s !== ch).map((s) => ({ ch: s, cost: COST[`${ch}→${s}`] ?? 0.8 }));
      options.push([{ ch, cost: 0 }, ...extra]);
    } else if (subs[ch] && subs[ch].length) {
      options.push(subs[ch].map((s) => ({ ch: s, cost: COST[`${ch}→${s}`] ?? 0.8 })));
    } else {
      dropped.push(ch);
    }
  }
  if (options.length === 0) return [];

  // Enumerate combinations, bounded. Beam search keeps the best partial spellings.
  let beam: Array<{ hex: string; cost: number; subs: number }> = [{ hex: '', cost: 0, subs: 0 }];
  for (const opts of options) {
    const next: typeof beam = [];
    for (const b of beam) {
      for (const o of opts) {
        next.push({ hex: b.hex + o.ch, cost: b.cost + o.cost, subs: b.subs + (o.cost > 0 ? 1 : 0) });
      }
    }
    next.sort((a, b) => a.cost - b.cost);
    beam = next.slice(0, 40);
  }

  const dictHex = new Set(HEXSPEAK_UNIQUE.map((h) => h.hex));
  const seen = new Set<string>();
  const out: HexSuggestion[] = [];
  for (const b of beam) {
    const hex = b.hex.slice(0, chain.addressLength);
    if (seen.has(hex)) continue;
    seen.add(hex);
    const maxCost = options.length * 0.8 + 0.001;
    const dropPenalty = dropped.length / Math.max(1, w.length);
    out.push({
      hex,
      readability: Math.max(0, 1 - b.cost / maxCost - dropPenalty),
      dropped,
      substitutions: b.subs,
      fromDictionary: dictHex.has(hex),
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** Dictionary entries whose word starts with the query, for autocomplete. */
export function dictionaryMatches(query: string, limit = 8): typeof HEXSPEAK_UNIQUE {
  const q = query.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!q) return HEXSPEAK_UNIQUE.slice(0, limit);
  const starts = HEXSPEAK_UNIQUE.filter((h) => h.word.startsWith(q));
  const contains = HEXSPEAK_UNIQUE.filter((h) => !h.word.startsWith(q) && h.word.includes(q));
  return [...starts, ...contains].slice(0, limit);
}

/** Human description of what could not be expressed. */
export function droppedExplanation(dropped: string[]): string | null {
  if (!dropped.length) return null;
  const letters = [...new Set(dropped)].map((c) => c.toUpperCase()).join(', ');
  return `${letters} ${dropped.length === 1 ? 'has' : 'have'} no hex look-alike, so ${dropped.length === 1 ? 'it was' : 'they were'} left out.`;
}
