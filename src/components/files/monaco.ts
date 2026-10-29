/**
 * Monaco bootstrap — CLIENT-ONLY module, imported dynamically by
 * <CodeEditor> (never during SSR): loads the editor bundle and exposes the
 * small factory the React wrapper drives.
 *
 * The editor only opens WHITELISTED text files (see
 * `EDITABLE_FILE_EXTENSIONS`): json/yaml/xml/ini/properties/txt — binaries
 * never reach it (the shard refuses them, and the file browser only offers
 * the editor for the whitelist).
 *
 * Validation per language:
 * - JSON: the JSON language worker (syntax; comments tolerated, no schema
 *   fetch — offline-safe),
 * - XML: the browser DOMParser,
 * - INI: a structural pass (sections, empty/duplicate keys).
 * - YAML/txt: none (for now).
 */
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker.js?worker';

import { extensionOf } from '~/lib/text-files';

// ─── Workers (Vite ?worker imports — bundled locally, no CDN) ────────────────

globalThis.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === 'json') return new JsonWorker();
    return new EditorWorker();
  },
};

// JSON: syntax validation out of the box (comments tolerated — plenty of
// game configs ship jsonc-style files), no remote schema fetch.
monaco.json.jsonDefaults.setDiagnosticsOptions({
  validate: true,
  allowComments: true,
  enableSchemaRequest: false,
});

// ─── Themes (match the app palette; dark = the console's #0d1117) ────────────

monaco.editor.defineTheme('mojito-light', {
  base: 'vs',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#ffffff',
    'editorLineNumber.foreground': '#a1a1aa',
  },
});

monaco.editor.defineTheme('mojito-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#0d1117',
    'editorLineNumber.foreground': '#6e7681',
  },
});

/** Applies the app theme to every editor (light/dark toggle). */
export function applyMonacoTheme(dark: boolean): void {
  monaco.editor.setTheme(dark ? 'mojito-dark' : 'mojito-light');
}

// ─── Language detection ──────────────────────────────────────────────────────

/** Monaco language id for an editable file (whitelist — see ~/lib/text-files). */
function languageFor(path: string): string {
  switch (extensionOf(path)) {
    case 'json':
      return 'json';
    case 'yaml':
    case 'yml':
      return 'yaml';
    case 'xml':
      return 'xml';
    case 'ini':
    case 'properties':
      return 'ini';
    default:
      return 'plaintext'; // .txt — anything newly whitelisted without a language
  }
}

// ─── XML validation (browser DOMParser — no extra dependency) ────────────────

/** Extracts "line N at column M" from a DOMParser parsererror node. */
function parseErrorPosition(text: string): { line: number; column: number } {
  const match = /[Ll]ine\D+(\d+)\D+column\D+(\d+)/.exec(text);
  return match ? { line: Number(match[1]), column: Number(match[2]) } : { line: 1, column: 1 };
}

function validateXml(model: monaco.editor.ITextModel): void {
  const content = model.getValue();
  const markers: monaco.editor.IMarkerData[] = [];
  if (content.trim()) {
    const parsed = new DOMParser().parseFromString(content, 'application/xml');
    const errorNode = parsed.getElementsByTagName('parsererror')[0];
    if (errorNode) {
      const text = errorNode.textContent ?? 'XML invalide';
      const message =
        text.split('\n').find((line) => /error/i.test(line))?.trim() || text.trim().slice(0, 200);
      const { line, column } = parseErrorPosition(text);
      markers.push({
        severity: monaco.MarkerSeverity.Error,
        message,
        startLineNumber: line,
        startColumn: column,
        endLineNumber: line,
        endColumn: column + 1,
      });
    }
  }
  monaco.editor.setModelMarkers(model, 'mojito-xml', markers);
}

// ─── INI validation (structural — malformed sections, empty/duplicate keys) ──

function validateIni(model: monaco.editor.ITextModel): void {
  const markers: monaco.editor.IMarkerData[] = [];
  /** `section\x00key` → already seen (duplicate detection, last wins). */
  const seen = new Set<string>();
  let section = '';

  model.getValue().split('\n').forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) return;

    if (line.startsWith('[')) {
      if (!line.endsWith(']') || line.length < 3) {
        markers.push({
          severity: monaco.MarkerSeverity.Error,
          message: 'Section mal formée — attendu [nom]',
          startLineNumber: index + 1,
          startColumn: 1,
          endLineNumber: index + 1,
          endColumn: line.length + 1,
        });
      } else {
        section = line.slice(1, -1).trim().toLowerCase();
      }
      return;
    }

    const separator = line.indexOf('=');
    if (separator === -1) {
      markers.push({
        severity: monaco.MarkerSeverity.Error,
        message: 'Une entrée doit être de la forme clé=valeur',
        startLineNumber: index + 1,
        startColumn: 1,
        endLineNumber: index + 1,
        endColumn: line.length + 1,
      });
      return;
    }
    const key = line.slice(0, separator).trim();
    if (!key) {
      markers.push({
        severity: monaco.MarkerSeverity.Error,
        message: 'Clé vide avant « = »',
        startLineNumber: index + 1,
        startColumn: separator + 1,
        endLineNumber: index + 1,
        endColumn: separator + 2,
      });
      return;
    }
    const id = `${section}\u0000${key.toLowerCase()}`;
    if (seen.has(id)) {
      markers.push({
        severity: monaco.MarkerSeverity.Warning,
        message: `Clé « ${key} » déjà définie${section ? ` dans [${section}]` : ''} — la dernière valeur gagne`,
        startLineNumber: index + 1,
        startColumn: 1,
        endLineNumber: index + 1,
        endColumn: separator + 1,
      });
    } else {
      seen.add(id);
    }
  });

  monaco.editor.setModelMarkers(model, 'mojito-ini', markers);
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export interface CreateCodeEditorOptions {
  /** Relative path of the file (drives the language + validation). */
  path: string;
  value: string;
  readOnly: boolean;
  dark: boolean;
  onChange: (content: string) => void;
  /** Ctrl/Cmd+S inside the editor. */
  onSave: () => void;
}

export interface CodeEditorHandle {
  editor: monaco.editor.IStandaloneCodeEditor;
  dispose(): void;
}

/**
 * Creates a Monaco editor in the container (one model per file). JSON is
 * validated by its language worker; XML/INI by a debounced parser /
 * structural pass. Markers are advisory — saving is never blocked.
 */
export function createCodeEditor(
  container: HTMLElement,
  options: CreateCodeEditorOptions,
): CodeEditorHandle {
  const language = languageFor(options.path);
  // Validation keys off the EXTENSION, not the Monaco language: .properties
  // shares the ini highlighting but is laxer (bare keys, `!` comments,
  // multi-line continuations) — the INI structural pass would false-positive.
  const extension = extensionOf(options.path);
  const model = monaco.editor.createModel(options.value, language);

  const editor = monaco.editor.create(container, {
    model,
    theme: options.dark ? 'mojito-dark' : 'mojito-light',
    readOnly: options.readOnly,
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 13,
    wordWrap: 'on',
    scrollBeyondLastLine: false,
    padding: { top: 10, bottom: 10 },
    scrollbar: { alwaysConsumeMouseWheel: false },
  });

  // Ctrl/Cmd+S saves — the command lives for the editor's lifetime
  // (addCommand returns a command id, not a disposable).
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => options.onSave());

  // Validation debounce — 400 ms after the last keystroke.
  let validationTimer: ReturnType<typeof setTimeout> | null = null;
  const validate = () => {
    validationTimer = null;
    if (extension === 'xml') validateXml(model);
    else if (extension === 'ini') validateIni(model);
    // json is validated by its language worker; yaml/txt/properties have
    // none (for now).
  };
  validate();

  const changeDisposable = editor.onDidChangeModelContent(() => {
    options.onChange(editor.getValue());
    if (validationTimer) clearTimeout(validationTimer);
    validationTimer = setTimeout(validate, 400);
  });

  return {
    editor,
    dispose() {
      changeDisposable.dispose();
      if (validationTimer) clearTimeout(validationTimer);
      model.dispose();
      editor.dispose();
    },
  };
}
