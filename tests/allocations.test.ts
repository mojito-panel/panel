import { describe, it, expect } from 'vitest';
import { parsePortsSpec, PORTS_SPEC_MESSAGE, createAllocationsSchema } from '~/validators/node';

describe('parsePortsSpec', () => {
  it('parses a single port', () => {
    expect(parsePortsSpec('25565')).toEqual([25565]);
  });

  it('parses a comma-separated list and trims spaces', () => {
    expect(parsePortsSpec('25565, 25599 ,25570')).toEqual([25565, 25570, 25599]);
  });

  it('parses a range and expands it in order', () => {
    expect(parsePortsSpec('25570-25573')).toEqual([25570, 25571, 25572, 25573]);
  });

  it('mixes ranges and single ports, deduplicated and sorted', () => {
    expect(parsePortsSpec('25571, 25570-25572, 25565')).toEqual([25565, 25570, 25571, 25572]);
  });

  it('rejects an empty spec', () => {
    expect(parsePortsSpec('')).toBeNull();
    expect(parsePortsSpec('  ')).toBeNull();
  });

  it('rejects ports below 1024 or above 65535', () => {
    expect(parsePortsSpec('80')).toBeNull();
    expect(parsePortsSpec('70000')).toBeNull();
    expect(parsePortsSpec('1020-1030')).toBeNull();
  });

  it('rejects an inverted or empty range', () => {
    expect(parsePortsSpec('25575-25570')).toBeNull();
    expect(parsePortsSpec('25570-25570')).toBeNull();
  });

  it('rejects garbage tokens', () => {
    expect(parsePortsSpec('abc')).toBeNull();
    expect(parsePortsSpec('25565abc')).toBeNull();
    expect(parsePortsSpec('25565-')).toBeNull();
  });

  it('rejects an import larger than the safety cap', () => {
    expect(parsePortsSpec('1024-2048')).toBeNull();
  });
});

describe('createAllocationsSchema', () => {
  it('validates a minimal payload', () => {
    const result = createAllocationsSchema.safeParse({
      nodeId: 'node-1',
      ip: '0.0.0.0',
      ports: '25565',
      alias: '',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty ports spec', () => {
    const result = createAllocationsSchema.safeParse({
      nodeId: 'node-1',
      ip: '0.0.0.0',
      ports: '',
      alias: '',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('Indique au moins un port');
    }
  });

  it('exposes a readable message constant for the UI hint', () => {
    expect(PORTS_SPEC_MESSAGE).toContain('25570-25575');
  });
});
