import type { ListFilter, ListMode } from '~/lists/define';

/**
 * Filter function a declaration maps to when the filtering happens in the
 * browser: the three functions are the client twins of the server filters, and
 * they all read the STRING wire form (`'mc'`, `'a,b'`, `'true'`).
 *
 * Server-side lists return `undefined` — their filtering is `applyListQuery`'s.
 */
export type ClientFilterFnName =
  | 'wireIncludesString'
  | 'wireEquals'
  | 'wireArrIncludesSome'
  | 'wireIsNull';

export function clientFilterFn(
  filter: ListFilter | undefined,
  mode: ListMode,
): ClientFilterFnName | undefined {
  if (!filter || mode !== 'client') return undefined;

  switch (filter.control) {
    case 'text':
      return 'wireIncludesString';
    case 'boolean':
      return 'wireEquals';
    case 'nullable':
      return 'wireIsNull';
    case 'choice':
      return filter.multiple ? 'wireArrIncludesSome' : 'wireEquals';
  }
}
