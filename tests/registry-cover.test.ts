import { describe, it, expect } from 'vitest';

import { coverCandidates } from '../src/server/git-source';

describe('coverCandidates', () => {
  it('puts the recipe OWN base name first (recipe-icarus.json -> recipe-icarus.*)', () => {
    const candidates = coverCandidates('steamcmd/icarus/recipe-icarus.json');
    const names = candidates.map((candidate) => candidate.name);

    expect(names.slice(0, 4)).toEqual([
      'recipe-icarus.png',
      'recipe-icarus.jpg',
      'recipe-icarus.jpeg',
      'recipe-icarus.webp',
    ]);
  });

  it('falls back to the shared sibling cover.* (legacy convention)', () => {
    const candidates = coverCandidates('steamcmd/icarus/recipe-icarus.json');
    const names = candidates.map((candidate) => candidate.name);

    expect(names.slice(4)).toEqual(['cover.png', 'cover.jpg', 'cover.jpeg', 'cover.webp']);
  });

  it('carries the mime type of each extension', () => {
    const candidates = coverCandidates('recipe-x.json');

    const byName = new Map(candidates.map((candidate) => [candidate.name, candidate.mime]));
    expect(byName.get('recipe-x.png')).toBe('image/png');
    expect(byName.get('recipe-x.jpg')).toBe('image/jpeg');
    expect(byName.get('recipe-x.jpeg')).toBe('image/jpeg');
    expect(byName.get('recipe-x.webp')).toBe('image/webp');
  });

  it('keeps the recipe directory implicit (names only — the caller joins)', () => {
    // The candidates are file NAMES, never the joined path: the caller
    // resolves them against the recipe's own directory.
    const candidates = coverCandidates('a/b/recipe-x.json');
    for (const candidate of candidates) {
      expect(candidate.name).not.toContain('/');
    }
  });
});
