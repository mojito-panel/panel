import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { parseRecipe, type RecipeInput } from '@mojito/contract';
import { runInstall, type InstallProgress, type InstallEvent } from '../src/server/installer';
import { resolveVariables, render } from '../src/server/templating';
import type { SystemVariables } from '../src/server/templating';
import { resolvePath } from '../src/server/installer/context';
import { runWrite } from '../src/server/installer/actions/write';
import { runReplace } from '../src/server/installer/actions/replace';
import { runConfigFile } from '../src/server/installer/actions/config-file';
import { runExtract, resolveZipEntryPath } from '../src/server/installer/actions/extract';
import { exec, execProcess } from '../src/server/installer/actions/exec';
import { runScript } from '../src/server/installer/actions/exec';

let tmpRoot: string;
let httpServer: ReturnType<typeof createServer>;
let httpPort: number;

const systemVars: SystemVariables = {
  SERVER_UUID: '550e8400-e29b-41d4-a716-446655440000',
  SERVER_NAME: 'test-server',
  SERVER_MEMORY: 2048,
  SERVER_PORT: 25565,
  SERVER_IP: '0.0.0.0',
  SERVER_INSTALL_DIR: '',
};

beforeAll(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'mojito-runner-'));
  systemVars.SERVER_INSTALL_DIR = tmpRoot;

  // Small HTTP server to test download
  httpServer = createServer((req, res) => {
    if (req.url === '/server.jar') {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.end(Buffer.from('fake-jar-content'));
    } else if (req.url === '/missing') {
      res.writeHead(404);
      res.end('not found');
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  httpPort = (httpServer.address() as AddressInfo).port;
});

afterAll(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

/** Reusable minimal test recipe. */
function makeRecipe(overrides: Partial<RecipeInput> = {}) {
  return parseRecipe({
    schemaVersion: 2,
    id: 'test-recipe',
    name: 'Test',
    author: 'me',
    variables: [
      { env: 'RAM_MB', name: 'RAM', type: 'number', defaultValue: 1024 },
    ],
    install: [],
    start: { command: 'echo ok' },
    ...overrides,
  });
}

// ─── Action write ─────────────────────────────────────────────────────────────

describe('action write', () => {
  it('writes a file with templating and creates parent folders', async () => {
    const recipe = makeRecipe();
    const vars = resolveVariables(recipe, {}, systemVars);
    await runWrite(
      { action: 'write', file: 'config/settings.txt', content: 'ram={{RAM_MB}} port={{SERVER_PORT}}' },
      { installDir: tmpRoot, vars },
    );
    const content = await readFile(join(tmpRoot, 'config', 'settings.txt'), 'utf-8');
    expect(content).toBe('ram=1024 port=25565');
  });

  it('refuses a path escaping the install folder', async () => {
    const recipe = makeRecipe();
    const vars = resolveVariables(recipe, {}, systemVars);
    await expect(
      runWrite(
        { action: 'write', file: '../escape.txt', content: 'x' },
        { installDir: tmpRoot, vars },
      ),
    ).rejects.toThrow();
  });
});

// ─── Action replace ───────────────────────────────────────────────────────────

describe('action replace', () => {
  it('replaces a simple string', async () => {
    await writeFile(join(tmpRoot, 'app.cfg'), 'memory=512\nmode=a\n');
    const recipe = makeRecipe();
    const vars = resolveVariables(recipe, {}, systemVars);
    await runReplace(
      { action: 'replace', file: 'app.cfg', find: 'memory=512', replace: 'memory={{RAM_MB}}' },
      { installDir: tmpRoot, vars },
    );
    const content = await readFile(join(tmpRoot, 'app.cfg'), 'utf-8');
    expect(content).toBe('memory=1024\nmode=a\n');
  });

  it('replaces with a regex', async () => {
    await writeFile(join(tmpRoot, 'regex.cfg'), 'version=1.2.3\n');
    const recipe = makeRecipe();
    const vars = resolveVariables(recipe, {}, systemVars);
    await runReplace(
      { action: 'replace', file: 'regex.cfg', find: 'version=.*', replace: 'version=2.0.0', regex: true },
      { installDir: tmpRoot, vars },
    );
    const content = await readFile(join(tmpRoot, 'regex.cfg'), 'utf-8');
    expect(content).toBe('version=2.0.0\n');
  });
});

// ─── Action configFile ────────────────────────────────────────────────────────

describe('action configFile (parsers)', () => {
  it('creates the file if it does not exist (server.properties before first boot)', async () => {
    const file = join(tmpRoot, 'sub', 'server.properties');
    const recipe = makeRecipe();
    const vars = resolveVariables(recipe, {}, systemVars);
    await runConfigFile(
      {
        action: 'configFile',
        file: 'sub/server.properties',
        parser: 'properties',
        find: { 'server-port': '{{SERVER_PORT}}', 'motd': 'Hello' },
      },
      { installDir: tmpRoot, vars },
    );
    const content = await readFile(file, 'utf-8');
    expect(content).toContain('server-port=25565');
    expect(content).toContain('motd=Hello');
  });

  it('parser properties: replaces and adds keys', async () => {
    const file = join(tmpRoot, 'server.properties');
    await writeFile(file, '# comment\nmotd=Hello\nmax-players=20\n');
    const recipe = makeRecipe();
    const vars = resolveVariables(recipe, {}, systemVars);
    await runConfigFile(
      {
        action: 'configFile',
        file: 'server.properties',
        parser: 'properties',
        find: { 'server-port': '{{SERVER_PORT}}', 'motd': 'New MOTD' },
      },
      { installDir: tmpRoot, vars },
    );
    const content = await readFile(file, 'utf-8');
    expect(content).toContain('motd=New MOTD');
    expect(content).toContain('server-port=25565');
    expect(content).toContain('# comment');
    expect(content).toContain('max-players=20');
  });

  it('parser ini: handles sections', async () => {
    const file = join(tmpRoot, 'config.ini');
    await writeFile(file, '[server]\nname=old\nport=1111\n');
    const recipe = makeRecipe();
    const vars = resolveVariables(recipe, {}, systemVars);
    await runConfigFile(
      {
        action: 'configFile',
        file: 'config.ini',
        parser: 'ini',
        find: { 'server.port': '{{SERVER_PORT}}' },
      },
      { installDir: tmpRoot, vars },
    );
    const content = await readFile(file, 'utf-8');
    expect(content).toContain('port=25565');
    expect(content).toContain('name=old');
  });

  it('parser json: nested paths', async () => {
    const file = join(tmpRoot, 'settings.json');
    await writeFile(file, JSON.stringify({ server: { port: 1111, ip: '0.0.0.0' }, extra: true }));
    const recipe = makeRecipe();
    const vars = resolveVariables(recipe, {}, systemVars);
    await runConfigFile(
      {
        action: 'configFile',
        file: 'settings.json',
        parser: 'json',
        find: { 'server.port': '{{SERVER_PORT}}' },
      },
      { installDir: tmpRoot, vars },
    );
    const doc = JSON.parse(await readFile(file, 'utf-8'));
    expect(doc.server.port).toBe('25565');
    expect(doc.server.ip).toBe('0.0.0.0');
    expect(doc.extra).toBe(true);
  });

  it('parser yaml: nested paths and coercion', async () => {
    const file = join(tmpRoot, 'settings.yml');
    await writeFile(file, 'server:\n  port: 1111\n');
    const recipe = makeRecipe();
    const vars = resolveVariables(recipe, {}, systemVars);
    await runConfigFile(
      {
        action: 'configFile',
        file: 'settings.yml',
        parser: 'yaml',
        find: { 'server.port': '{{SERVER_PORT}}' },
      },
      { installDir: tmpRoot, vars },
    );
    const content = await readFile(file, 'utf-8');
    expect(content).toContain('port: 25565');
  });
});

// ─── Action extract ───────────────────────────────────────────────────────────

describe('action extract', () => {
  it('extracts a zip with stripComponents', async () => {
    // Create a test zip: root/nested/file.txt
    const zip = new AdmZip();
    zip.addFile('root/nested/file.txt', Buffer.from('hello zip'));
    const archivePath = join(tmpRoot, 'test.zip');
    zip.writeZip(archivePath);

    const recipe = makeRecipe();
    const vars = resolveVariables(recipe, {}, systemVars);
    await runExtract(
      { action: 'extract', archive: 'test.zip', dest: 'extracted', stripComponents: 1 },
      { installDir: tmpRoot, vars },
    );
    const content = await readFile(join(tmpRoot, 'extracted', 'nested', 'file.txt'), 'utf-8');
    expect(content).toBe('hello zip');
  });

  it('refuses path traversal (direct validation)', () => {
    expect(() => resolveZipEntryPath(tmpRoot, '../evil.txt')).toThrow('path traversal');
    expect(() => resolveZipEntryPath(tmpRoot, 'a/../../evil.txt')).toThrow('path traversal');
    expect(() => resolveZipEntryPath(tmpRoot, 'a/..\\b.txt')).toThrow('path traversal');
    expect(() => resolveZipEntryPath(tmpRoot, '/absolute/path.txt')).toThrow('path traversal');
    expect(() => resolveZipEntryPath(tmpRoot, 'root/file.txt', 5)).toThrow('stripComponents');
    // Valid path
    expect(resolveZipEntryPath(tmpRoot, 'root/nested/file.txt', 1)).toBe(
      join(tmpRoot, 'nested', 'file.txt'),
    );
  });
});

// ─── exec (command/script) ───────────────────────────────────────────────────

describe('exec', () => {
  it('runs a command and captures stdout', async () => {
    const isWindows = process.platform === 'win32';
    const result = await exec(isWindows ? 'echo hello' : 'echo hello');
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toContain('hello');
  });

  it('timeout kills the command', async () => {
    const isWindows = process.platform === 'win32';
    const sleepCmd = isWindows ? 'ping -n 10 127.0.0.1' : 'sleep 10';
    await expect(exec(sleepCmd, { timeoutMs: 500 })).rejects.toThrow('expirée');
  });

  it('streams stdout lines as they come (onLine)', async () => {
    const lines: { stream: string; text: string; rewrite: boolean }[] = [];
    const result = await execProcess(
      process.execPath,
      ['-e', 'console.log("one"); setTimeout(() => { console.log("two"); }, 80);'],
      { onLine: (stream, text, rewrite) => lines.push({ stream, text, rewrite }) },
    );
    expect(result.code).toBe(0);
    // Emitted DURING execution, in order — not after the process ends
    expect(lines).toEqual([
      { stream: 'stdout', text: 'one', rewrite: false },
      { stream: 'stdout', text: 'two', rewrite: false },
    ]);
  });

  it('marks \\r rewrites (steamcmd progress) as rewrite', async () => {
    const lines: { text: string; rewrite: boolean }[] = [];
    await execProcess(
      process.execPath,
      ['-e', 'process.stdout.write("progress 10%\\rprogress 20%\\rend\\n");'],
      { onLine: (_stream, text, rewrite) => lines.push({ text, rewrite }) },
    );
    // Lone \r = line rewrite (progress bar), \r\n = real line
    expect(lines).toEqual([
      { text: 'progress 10%', rewrite: true },
      { text: 'progress 20%', rewrite: true },
      { text: 'end', rewrite: false },
    ]);
  });
});

// ─── action script (direct spawn, Windows quoting) ───────────────────────────

describe('action script', () => {
  it('runs a powershell script (path with spaces + UTF-8 accents)', async () => {
    if (process.platform !== 'win32') return;

    const recipe = makeRecipe();
    const vars = resolveVariables(recipe, {}, systemVars);
    // Folder with spaces: the old cmd /c string pass corrupted
    // the -File quoting ("Illegal characters in path").
    const installDir = join(tmpRoot, 'folder with spaces');
    await mkdir(installDir, { recursive: true });

    await runScript(
      {
        action: 'script',
        shell: 'powershell',
        content: 'Write-Output "Installation successful — {{SERVER_NAME}}"',
      },
      { installDir, vars },
    );
  });
});

// ─── runInstall orchestrator ─────────────────────────────────────────────────

describe('runInstall', () => {
  it('runs a complete install with progress', async () => {
    const recipe = makeRecipe({
      install: [
        {
          action: 'download',
          url: `http://127.0.0.1:${httpPort}/server.jar`,
          dest: 'server.jar',
        },
        { action: 'write', file: 'eula.txt', content: 'eula=true' },
        {
          action: 'configFile',
          file: 'eula.txt',
          parser: 'properties',
          find: { 'eula': 'false' },
        },
      ],
    });

    const installDir = join(tmpRoot, 'srv1');
    const progress: InstallProgress[] = [];
    const result = await runInstall({
      recipe,
      variables: {},
      systemVariables: { ...systemVars, SERVER_INSTALL_DIR: installDir },
      installDir,
      onProgress: (p) => progress.push(p),
    });

    expect(result.success).toBe(true);
    expect(result.resolvedVars.get('RAM_MB')).toBe('1024');

    // Files created
    const jar = await readFile(join(installDir, 'server.jar'), 'utf-8');
    expect(jar).toBe('fake-jar-content');
    const eula = await readFile(join(installDir, 'eula.txt'), 'utf-8');
    expect(eula).toBe('eula=false');

    // Progress: 3 steps + final
    expect(progress.length).toBe(4);
    expect(progress[0].percent).toBe(0);
    expect(progress[progress.length - 1].percent).toBe(100);
    expect(progress[progress.length - 1].message).toBe('Installation terminée');
  });

  it('fails cleanly when the download is 404', async () => {
    const recipe = makeRecipe({
      install: [
        { action: 'download', url: `http://127.0.0.1:${httpPort}/missing`, dest: 'x.bin' },
      ],
    });
    const installDir = join(tmpRoot, 'srv404');
    const result = await runInstall({
      recipe,
      variables: {},
      systemVariables: { ...systemVars, SERVER_INSTALL_DIR: installDir },
      installDir,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('404');
  });

  it('fails when an unknown variable is used', async () => {
    const recipe = makeRecipe({
      start: { command: 'java -jar {{TOTALLY_UNKNOWN}}' },
    });
    const result = await runInstall({
      recipe,
      variables: {},
      systemVariables: systemVars,
      installDir: join(tmpRoot, 'srv-unknown'),
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('TOTALLY_UNKNOWN');
  });

  it('fails when a server variable is invalid', async () => {
    const recipe = makeRecipe({
      variables: [
        {
          env: 'RAM_MB',
          name: 'RAM',
          type: 'number',
          defaultValue: 1024,
          min: 512,
          max: 4096,
        },
      ],
    });
    const result = await runInstall({
      recipe,
      variables: { RAM_MB: 99999 },
      systemVariables: systemVars,
      installDir: join(tmpRoot, 'srv-invalid'),
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('4096');
  });

  it('tolerates successCodes exit codes (steamcmd: 7 = auto-update)', async () => {
    const recipe = makeRecipe({
      install: [
        { action: 'command', command: 'exit 7', successCodes: [0, 7] },
      ],
    });
    const result = await runInstall({
      recipe,
      variables: {},
      systemVariables: systemVars,
      installDir: join(tmpRoot, 'srv-exit7-ok'),
    });
    expect(result.success).toBe(true);
  });

  it('fails on an exit code not listed in successCodes', async () => {
    const recipe = makeRecipe({
      install: [{ action: 'command', command: 'exit 7' }],
    });
    const result = await runInstall({
      recipe,
      variables: {},
      systemVariables: systemVars,
      installDir: join(tmpRoot, 'srv-exit7-ko'),
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('code 7');
  });

  it('streams progress via tail of a log written by the command (steamcmd)', async () => {
    // Helper: writes 5 lines into progress.log, 120 ms interval —
    // NOTHING on stdout: the only source of step-output is the tail.
    const writer =
      "const {appendFileSync}=require('node:fs');let i=0;" +
      "const t=setInterval(()=>{i++;" +
      "appendFileSync('progress.log','progress line '+i+'\\n');" +
      "if(i>=5)clearInterval(t);},120);";

    const recipe = makeRecipe({
      install: [
        { action: 'write', file: 'writer.js', content: writer },
        {
          action: 'command',
          command: 'node writer.js',
          timeoutMs: 10000,
          tail: { file: 'progress.log', intervalMs: 100 },
        },
        {
          action: 'command',
          command: 'node writer.js',
          timeoutMs: 10000,
          tail: { file: 'progress.log', intervalMs: 100, filter: 'progress line [13]' },
        },
      ],
    });

    const events: InstallEvent[] = [];
    const result = await runInstall({
      recipe,
      variables: {},
      systemVariables: systemVars,
      installDir: join(tmpRoot, 'srv-tail'),
      onEvent: (event) => events.push(event),
    });
    expect(result.success).toBe(true);

    const outputs = (step: number) =>
      events.flatMap((e) => (e.type === 'step-output' && e.step === step ? [e.text] : []));

    // Step 1 (without filter): the 5 lines, streamed before step-done
    for (let i = 1; i <= 5; i++) {
      expect(outputs(1)).toContain(`progress line ${i}`);
    }
    const step1Done = events.findIndex((e) => e.type === 'step-done' && e.step === 1);
    const step1First = events.findIndex((e) => e.type === 'step-output' && e.step === 1);
    expect(step1Done).toBeGreaterThan(step1First);

    // Step 2: the tail restarts from the current size (no replay of lines
    // 1-5) + the filter only keeps lines 1 and 3
    expect(outputs(2)).toEqual(['progress line 1', 'progress line 3']);
  });

  it('streams command output as step-output on the fly', async () => {
    if (process.platform !== 'win32') return;
    // Batch file (spawned via argument array — no cmd /c quoting):
    // two lines 80 ms apart prove real-time emission.
    const recipe = makeRecipe({
      install: [
        {
          action: 'script',
          shell: 'cmd',
          content:
            '@echo off\nnode -e "console.log(\'line1\'); setTimeout(() => console.log(\'line2\'), 80)"',
        },
      ],
    });
    const events: InstallEvent[] = [];
    const result = await runInstall({
      recipe,
      variables: {},
      systemVariables: systemVars,
      installDir: join(tmpRoot, 'srv-stream'),
      onEvent: (event) => events.push(event),
    });
    expect(result.success).toBe(true);

    const outputs = events.flatMap((e) => (e.type === 'step-output' ? [e.text] : []));
    expect(outputs).toEqual(['line1', 'line2']);
    // The output arrives BEFORE the step ends (streaming, no final buffer)
    const firstOutput = events.findIndex((e) => e.type === 'step-output');
    const stepDone = events.findIndex((e) => e.type === 'step-done');
    expect(stepDone).toBeGreaterThan(firstOutput);
  });
});

// ─── resolvePath ──────────────────────────────────────────────────────────────

describe('resolvePath', () => {
  it('relative path → join installDir', () => {
    expect(resolvePath('/srv/data', 'a/b.txt')).toBe(join('/srv/data', 'a', 'b.txt'));
  });
  it('absolute path → unchanged', () => {
    expect(resolvePath('/srv/data', 'C:\\other\\file.txt')).toBe('C:\\other\\file.txt');
  });
});

// render imported to avoid an unused warning if the tests above evolve
void render;
