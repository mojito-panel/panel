import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FilterControl, toggleChip } from '~/components/data-table/data-table-filters';
import type { ListFilterChoice } from '~/lists/define';

/**
 * The filter popover's Select is CLOSED while the toolbar renders, and base-ui
 * only resolves an item's label once that item is mounted (i.e. after the popup
 * opened) — so a closed trigger used to show the raw value (`online`) instead of
 * the option label ("En ligne"). These render that trigger and pin the fix.
 */

const STATUS_OPTIONS = [
  { value: 'online', label: 'En ligne' },
  { value: 'offline', label: 'Hors ligne' },
];

const statusFilter: ListFilterChoice = {
  control: 'choice',
  target: { path: 'status' },
  options: STATUS_OPTIONS,
};

const noop = () => {};

/** Text of the closed Select trigger (`data-slot="select-value"`). */
function triggerText(html: string): string {
  return /data-slot="select-value"[^>]*>([^<]*)</.exec(html)?.[1]?.trim() ?? '';
}

function renderChoice(value: string) {
  return renderToStaticMarkup(
    createElement(FilterControl, {
      filter: statusFilter,
      options: STATUS_OPTIONS,
      value,
      onChange: noop,
    }),
  );
}

describe('filter control (single choice)', () => {
  it('renders the option label of the selected value', () => {
    expect(triggerText(renderChoice('online'))).toBe('En ligne');
    expect(triggerText(renderChoice('offline'))).toBe('Hors ligne');
  });

  it('never renders the raw value in the trigger', () => {
    expect(renderChoice('online')).not.toContain('>online<');
  });

  it('renders the placeholder while nothing is selected', () => {
    expect(triggerText(renderChoice(''))).toBe('Toutes les valeurs');
  });

  it('falls back to the raw value when its option is not loaded yet', () => {
    // A `dynamic` filter (node ids) can render before its options arrive.
    expect(triggerText(renderChoice('node_123'))).toBe('node_123');
  });
});

describe('chip toggle (boolean/nullable filters)', () => {
  it('switches value in one click while the other state is active', () => {
    // Clicking "Non" while "Oui" is selected must REPLACE it, not be swallowed.
    expect(toggleChip(['true'], 'false', true)).toEqual(['false']);
    expect(toggleChip(['false'], 'true', true)).toEqual(['true']);
  });

  it('clears the filter when the active chip is clicked again', () => {
    expect(toggleChip(['true'], 'true', true)).toEqual([]);
    expect(toggleChip(['false'], 'false', true)).toEqual([]);
  });

  it('stays additive for a multi-choice filter', () => {
    expect(toggleChip(['running'], 'stopped', false)).toEqual(['running', 'stopped']);
    expect(toggleChip(['running', 'stopped'], 'running', false)).toEqual(['stopped']);
  });
});
