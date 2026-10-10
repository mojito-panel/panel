/**
 * Config file parsers (≈ wings parser/ package): typed key updates for
 * the `configFile` install action (equivalent of Pelican's `config.files`).
 * Every parser replaces/creates the requested keys and preserves the rest.
 */

import { applyProperties } from './properties';
import { applyIni } from './ini';
import { applyYaml } from './yaml';
import { applyJson } from './json';

export { applyProperties, applyIni, applyYaml, applyJson };

export type ConfigParser = 'properties' | 'ini' | 'yaml' | 'json';

/** Dispatches to the parser requested by the action. */
export function applyParser(
  parser: ConfigParser,
  content: string,
  find: Record<string, string>,
): string {
  switch (parser) {
    case 'properties':
      return applyProperties(content, find);
    case 'ini':
      return applyIni(content, find);
    case 'yaml':
      return applyYaml(content, find);
    case 'json':
      return applyJson(content, find);
  }
}
