// One-off: regenerate src/routeTree.gen.ts (same generator the vite plugin runs)
import { fileURLToPath } from 'node:url';
import { Generator, getConfig } from '@tanstack/router-generator';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const config = getConfig({ cwd }, cwd);
const generator = new Generator({ config, root: cwd });
await generator.run();
console.log('routeTree.gen.ts regenerated');
