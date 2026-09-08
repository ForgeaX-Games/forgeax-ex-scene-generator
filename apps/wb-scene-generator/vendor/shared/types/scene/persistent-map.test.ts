import { describe, expect, it } from 'vitest';
import { PersistentStringMap } from './persistent-map.js';

function keys(n: number, prefix = 'k'): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix}${i}`);
}

describe('PersistentStringMap', () => {
  it('starts empty', () => {
    const m = PersistentStringMap.empty<number>();
    expect(m.size).toBe(0);
    expect(m.get('a')).toBeUndefined();
    expect(m.has('a')).toBe(false);
  });

  it('set/get round-trips a single key', () => {
    const m = PersistentStringMap.empty<number>().set('a', 1);
    expect(m.get('a')).toBe(1);
    expect(m.size).toBe(1);
  });

  it('set never mutates the previous instance (immutability)', () => {
    const m0 = PersistentStringMap.empty<number>().set('a', 1);
    const m1 = m0.set('a', 2);
    expect(m0.get('a')).toBe(1);
    expect(m1.get('a')).toBe(2);
    expect(m0.size).toBe(1);
    expect(m1.size).toBe(1);
  });

  it('set with the same value (Object.is) is a no-op that returns the same reference', () => {
    const m0 = PersistentStringMap.empty<number>().set('a', 1);
    const m1 = m0.set('a', 1);
    expect(m1).toBe(m0);
  });

  it('handles hundreds of keys correctly regardless of insertion order', () => {
    const ks = keys(500);
    let m = PersistentStringMap.empty<number>();
    for (const k of ks) m = m.set(k, ks.indexOf(k));
    expect(m.size).toBe(500);
    for (const k of ks) expect(m.get(k)).toBe(ks.indexOf(k));
  });

  it('delete removes a key and shrinks size, leaving others intact', () => {
    let m = PersistentStringMap.empty<number>();
    for (const k of keys(50)) m = m.set(k, 1);
    const before = m.size;
    m = m.delete('k10');
    expect(m.size).toBe(before - 1);
    expect(m.get('k10')).toBeUndefined();
    expect(m.get('k9')).toBe(1);
    expect(m.get('k11')).toBe(1);
  });

  it('deleting a missing key is a no-op returning the same reference', () => {
    const m = PersistentStringMap.empty<number>().set('a', 1);
    expect(m.delete('missing')).toBe(m);
  });

  it('unrelated branches share structure: editing one key does not affect entries under a different subtree', () => {
    let m = PersistentStringMap.empty<string>();
    for (const k of keys(200)) m = m.set(k, `v-${k}`);
    const snapshot = m;
    m = m.set('k123', 'changed');
    // every other key must be untouched on the OLD reference and on the NEW one
    for (const k of keys(200)) {
      if (k === 'k123') continue;
      expect(snapshot.get(k)).toBe(`v-${k}`);
      expect(m.get(k)).toBe(`v-${k}`);
    }
    expect(snapshot.get('k123')).toBe('v-k123');
    expect(m.get('k123')).toBe('changed');
  });

  it('entries()/keys()/values() enumerate exactly the inserted set', () => {
    const ks = keys(64);
    let m = PersistentStringMap.empty<number>();
    ks.forEach((k, i) => (m = m.set(k, i)));
    expect(new Set(m.keys())).toEqual(new Set(ks));
    expect(new Set(m.values())).toEqual(new Set(ks.map((_, i) => i)));
    expect(new Map(m.entries()).size).toBe(64);
  });

  it('is order-independent: same key/value set, any insertion order, produces the same logical map', () => {
    const ks = keys(120);
    const shuffled = [...ks].reverse();
    let a = PersistentStringMap.empty<number>();
    ks.forEach((k, i) => (a = a.set(k, i)));
    let b = PersistentStringMap.empty<number>();
    shuffled.forEach((k) => (b = b.set(k, ks.indexOf(k))));
    for (const k of ks) expect(a.get(k)).toBe(b.get(k));
    expect(a.size).toBe(b.size);
  });

  it('survives a large number of keys (stresses branch/collision-node splitting)', () => {
    const ks = keys(5000, 'stress-');
    let m = PersistentStringMap.empty<number>();
    ks.forEach((k, i) => (m = m.set(k, i)));
    expect(m.size).toBe(5000);
    for (let i = 0; i < ks.length; i += 137) {
      expect(m.get(ks[i]!)).toBe(i);
    }
  });
});
