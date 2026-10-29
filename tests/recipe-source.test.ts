import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { canonicalJson } from '~/lib/canonical-json';
import {
  canonicalGitUrl,
  computeEntryStatus,
  computeRecipeStatus,
  formatGitSource,
  isSameRegistryRecipe,
  parseRecipeSource,
  recipeErrorMessage,
} from '~/lib/recipe-source';

// ─── canonicalJson ───────────────────────────────────────────────────────────

describe('canonicalJson', () => {
  it('is invariant to key order and whitespace', () => {
    const a = canonicalJson(JSON.parse('{ "name": "a", "list": [1, 2, 3], "nested": { "b": 1, "a": 2 } }'));
    const b = canonicalJson(JSON.parse('{"nested":{"a":2,"b":1},  "list":[1,2,3],"name":"a"}'));
    expect(a).toBe(b);
  });

  it('keeps array order (arrays are ordered by nature)', () => {
    const a = canonicalJson({ list: ['x', 'a'] });
    const b = canonicalJson({ list: ['a', 'x'] });
    expect(a).not.toBe(b);
  });

  it('handles scalars and null', () => {
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(42)).toBe('42');
    expect(canonicalJson('hi')).toBe('"hi"');
    expect(canonicalJson(true)).toBe('true');
  });
});

// ─── canonicalGitUrl ─────────────────────────────────────────────────────────

describe('canonicalGitUrl', () => {
  it('normalizes host case, .git suffix and trailing slashes', () => {
    expect(canonicalGitUrl('https://GitHub.com/Owner/Repo.git/')).toBe(
      'https://github.com/Owner/Repo',
    );
  });

  it('normalizes ssh URLs (user, port, .git suffix)', () => {
    expect(canonicalGitUrl('ssh://git@GitHub.com:2222/Owner/Repo.git/')).toBe(
      'ssh://git@github.com:2222/Owner/Repo',
    );
  });

  it('rewrites the SCP shorthand (git@host:path) to the ssh:// form', () => {
    expect(canonicalGitUrl('git@github.com:owner/repo.git')).toBe(
      'ssh://git@github.com/owner/repo',
    );
  });

  it('rejects plain http and other schemes', () => {
    expect(() => canonicalGitUrl('http://github.com/owner/repo')).toThrow();
    expect(() => canonicalGitUrl('ftp://github.com/owner/repo')).toThrow();
    expect(() => canonicalGitUrl('github.com/owner/repo')).toThrow();
  });

  it('refuses embedded passwords', () => {
    expect(() => canonicalGitUrl('https://user:secret@github.com/owner/repo')).toThrow();
  });

  it('preserves the path case (repository names are case-sensitive)', () => {
    expect(canonicalGitUrl('https://gitlab.com/Group/SubGroup/Recipes')).toBe(
      'https://gitlab.com/Group/SubGroup/Recipes',
    );
  });
});

// ─── Source URL forms ─────────────────────────────────────────────────────────

describe('parseRecipeSource / formatGitSource', () => {
  it('round-trips the git form (repo, branch, path)', () => {
    const url = formatGitSource('https://github.com/o/r', 'main', 'steamcmd/x/recipe-x.json');
    expect(url).toBe('https://github.com/o/r#main:steamcmd/x/recipe-x.json');
    expect(parseRecipeSource(url)).toEqual({
      kind: 'git',
      repoUrl: 'https://github.com/o/r',
      branch: 'main',
      path: 'steamcmd/x/recipe-x.json',
    });
  });

  it('round-trips the git form for ssh repositories too', () => {
    const url = formatGitSource('ssh://git@github.com/o/r', 'main', 'steamcmd/x/recipe-x.json');
    expect(parseRecipeSource(url)).toEqual({
      kind: 'git',
      repoUrl: 'ssh://git@github.com/o/r',
      branch: 'main',
      path: 'steamcmd/x/recipe-x.json',
    });
  });

  it('reads a URL without a fragment as a direct source', () => {
    expect(parseRecipeSource('https://raw.githubusercontent.com/o/r/main/x/recipe-x.json')).toEqual({
      kind: 'direct',
      url: 'https://raw.githubusercontent.com/o/r/main/x/recipe-x.json',
    });
  });

  it('returns null on a malformed fragment', () => {
    expect(parseRecipeSource('https://github.com/o/r#main')).toBeNull();
    expect(parseRecipeSource('https://github.com/o/r#:path.json')).toBeNull();
    expect(parseRecipeSource('#branch:path.json')).toBeNull();
  });
});

// ─── Recipe status ────────────────────────────────────────────────────────────

describe('computeRecipeStatus', () => {
  const base = {
    sourceUrl: 'https://github.com/o/r#main:x/recipe-x.json',
    sourceSha: 'aaa',
    remoteSha: 'aaa',
    remoteCheckedAt: new Date(),
    storedSha: 'aaa',
  };

  it('is local without a source, unchecked without a check', () => {
    expect(computeRecipeStatus({ ...base, sourceUrl: null })).toBe('local');
    expect(computeRecipeStatus({ ...base, remoteCheckedAt: null })).toBe('unchecked');
  });

  it('reads a null remote hash with a check date as gone upstream', () => {
    expect(computeRecipeStatus({ ...base, remoteSha: null })).toBe('upstream_gone');
  });

  it('detects an upstream change', () => {
    expect(computeRecipeStatus({ ...base, remoteSha: 'bbb' })).toBe('update_available');
  });

  it('detects local edits (outranks an available update)', () => {
    expect(computeRecipeStatus({ ...base, storedSha: 'zzz', remoteSha: 'bbb' })).toBe(
      'modified_locally',
    );
  });

  it('falls back to the stored content when no import stamp exists', () => {
    expect(computeRecipeStatus({ ...base, sourceSha: null })).toBe('up_to_date');
    expect(computeRecipeStatus({ ...base, sourceSha: null, remoteSha: 'bbb' })).toBe(
      'update_available',
    );
  });

  it('stays up to date when everything matches', () => {
    expect(computeRecipeStatus(base)).toBe('up_to_date');
  });
});

// ─── Catalog entry status ─────────────────────────────────────────────────────

describe('computeEntryStatus', () => {
  const entry = { error: null, sha: 'aaa' };
  const recipe = { recipeId: 'id', slug: 'x', name: 'X', sourceSha: 'aaa', storedSha: 'aaa' };

  it('lists invalid files as not importable', () => {
    expect(computeEntryStatus({ error: 'boom', sha: 'raw' }, null)).toBe('invalid');
  });

  it('reads no local copy as not imported', () => {
    expect(computeEntryStatus(entry, null)).toBe('not_imported');
  });

  it('compares the entry hash against the local copy', () => {
    expect(computeEntryStatus(entry, recipe)).toBe('up_to_date');
    expect(computeEntryStatus({ ...entry, sha: 'bbb' }, recipe)).toBe('update_available');
  });

  it('detects local edits (outranks an available update)', () => {
    expect(
      computeEntryStatus({ ...entry, sha: 'bbb' }, { ...recipe, storedSha: 'zzz' }),
    ).toBe('modified_locally');
  });
});

// ─── Registry entry ↔ recipe identity ────────────────────────────────────────

describe('isSameRegistryRecipe', () => {
  const registry = { url: 'https://github.com/o/r', branchName: 'main' };
  const entry = (path: string, slug: string | null) => ({ path, slug });
  const recipe = (slug: string, path: string) => ({
    slug,
    sourceUrl: formatGitSource(registry.url, registry.branchName, path),
  });

  it('matches by recipe id — a file renamed upstream stays the same recipe', () => {
    expect(
      isSameRegistryRecipe(
        registry,
        entry('runtimes/java/java.json', 'java'),
        recipe('java', 'runtimes/java/recipe-java.json'),
      ),
    ).toBe(true);
  });

  it('matches the recipe imported from the very same path', () => {
    expect(
      isSameRegistryRecipe(
        registry,
        entry('steamcmd/x/recipe-x.json', 'x'),
        recipe('x', 'steamcmd/x/recipe-x.json'),
      ),
    ).toBe(true);
  });

  it('refuses a different id sitting at the old path (file replaced by another recipe)', () => {
    expect(
      isSameRegistryRecipe(
        registry,
        entry('steamcmd/x/recipe-x.json', 'other'),
        recipe('x', 'steamcmd/x/recipe-x.json'),
      ),
    ).toBe(false);
  });

  it('falls back to the exact path for an entry that does not validate (no id)', () => {
    expect(
      isSameRegistryRecipe(
        registry,
        entry('steamcmd/x/recipe-x.json', null),
        recipe('x', 'steamcmd/x/recipe-x.json'),
      ),
    ).toBe(true);
    expect(
      isSameRegistryRecipe(
        registry,
        entry('steamcmd/x/recipe-x.json', null),
        recipe('x', 'steamcmd/x/x.json'),
      ),
    ).toBe(false);
  });

  it('stays scoped to the registry repository and branch', () => {
    const otherRepo = {
      slug: 'x',
      sourceUrl: formatGitSource('https://github.com/o/other', 'main', 'steamcmd/x/recipe-x.json'),
    };
    const otherBranch = {
      slug: 'x',
      sourceUrl: formatGitSource(registry.url, 'dev', 'steamcmd/x/recipe-x.json'),
    };
    expect(isSameRegistryRecipe(registry, entry('steamcmd/x/recipe-x.json', 'x'), otherRepo)).toBe(
      false,
    );
    expect(
      isSameRegistryRecipe(registry, entry('steamcmd/x/recipe-x.json', 'x'), otherBranch),
    ).toBe(false);
  });

  it('never matches before the first sync (no resolved branch)', () => {
    expect(
      isSameRegistryRecipe(
        { url: registry.url, branchName: '' },
        entry('steamcmd/x/recipe-x.json', 'x'),
        recipe('x', 'steamcmd/x/recipe-x.json'),
      ),
    ).toBe(false);
  });
});

// ─── Error formatting ─────────────────────────────────────────────────────────

describe('recipeErrorMessage', () => {
  it('passes through a plain error message', () => {
    expect(recipeErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('formats a ZodError as a field list', () => {
    const result = z.object({ id: z.string().min(1, 'requis') }).safeParse({ id: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(recipeErrorMessage(result.error)).toContain('id');
      expect(recipeErrorMessage(result.error)).toContain('requis');
    }
  });
});
