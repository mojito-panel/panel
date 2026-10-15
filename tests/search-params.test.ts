import { describe, it, expect } from 'vitest';
import { parseSearch, stringifySearch } from '~/lib/search-params';

/**
 * Search-param serialization used by the router: values must stay STRINGS in
 * both directions, otherwise a filter like `?status=true` or `?q=123` reaches
 * its schema as a boolean/number, fails validation and disappears from the URL.
 */
describe('search params', () => {
  it('keeps values the router would have converted', () => {
    expect(parseSearch('?status=true')).toEqual({ status: 'true' });
    expect(parseSearch('?q=123')).toEqual({ q: '123' });
    expect(parseSearch('?q=null')).toEqual({ q: 'null' });
    expect(parseSearch('?q=%22quoted%22')).toEqual({ q: '"quoted"' });
    expect(parseSearch('?q=%C3%A9t%C3%A9')).toEqual({ q: 'été' });
  });

  it('reads a comma list and a repeated key as-is', () => {
    expect(parseSearch('?status=running,stopped')).toEqual({ status: 'running,stopped' });
    expect(parseSearch('?status=running&status=stopped')).toEqual({
      status: ['running', 'stopped'],
    });
  });

  it('writes primitives without quoting and arrays as repeated keys', () => {
    expect(stringifySearch({ q: 'mc', size: 10 })).toBe('?q=mc&size=10');
    expect(stringifySearch({ status: ['running', 'stopped'] })).toBe(
      '?status=running&status=stopped',
    );
  });

  it('omits cleared parameters instead of writing them', () => {
    expect(stringifySearch({ q: 'mc', status: undefined, page: null, dir: '' })).toBe('?q=mc');
    expect(stringifySearch({})).toBe('');
  });

  it('round-trips a list query', () => {
    const query = { page: 2, size: 10, sort: 'name', dir: 'asc', q: '123', status: 'true' };
    expect(parseSearch(stringifySearch(query))).toEqual({
      page: '2',
      size: '10',
      sort: 'name',
      dir: 'asc',
      q: '123',
      status: 'true',
    });
  });
});
