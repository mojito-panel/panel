import { useEffect, useRef, useState } from 'react';
import { useTheme } from 'next-themes';

import { ErrorState } from '~/components/error/error-state';
import { Skeleton } from '~/components/ui/skeleton';

import type { CodeEditorHandle, CreateCodeEditorOptions } from './monaco';

/**
 * Monaco code editor wrapper — the editor itself is loaded dynamically in a
 * useEffect (SSR-safe, same pattern as the xterm console): the monaco bundle
 * is a lazy client chunk, the container renders a skeleton until it boots.
 * The content stays owned by the parent (controlled): every change bubbles
 * up through onChange, external updates (initial load) go through setValue.
 */
export function CodeEditor({
  path,
  value,
  readOnly,
  onChange,
  onSave,
}: {
  path: string;
  value: string;
  readOnly: boolean;
  onChange: (content: string) => void;
  /** Ctrl/Cmd+S inside the editor. */
  onSave: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  /** Re-runs the boot effect (chunk load retry). */
  const [attempt, setAttempt] = useState(0);
  const { resolvedTheme } = useTheme();

  // Callbacks + latest value/theme via refs: the editor must not be
  // recreated on re-renders (theme changes sync in place below), and the
  // async creation starts from the freshest content.
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const valueRef = useRef(value);
  const darkRef = useRef(resolvedTheme === 'dark');
  useEffect(() => {
    onChangeRef.current = onChange;
    onSaveRef.current = onSave;
    valueRef.current = value;
    darkRef.current = resolvedTheme === 'dark';
  });

  const editorRef = useRef<CodeEditorHandle['editor'] | null>(null);
  const handleRef = useRef<CodeEditorHandle | null>(null);

  // Boot — one editor per (path, readOnly): the parent re-keys on file change.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    handleRef.current = null;

    void (async () => {
      try {
        const setup = await import('./monaco');
        if (disposed || !containerRef.current) return;
        handleRef.current = setup.createCodeEditor(container, {
          path,
          value: valueRef.current,
          readOnly,
          dark: darkRef.current,
          onChange: (content) => onChangeRef.current(content),
          onSave: () => onSaveRef.current(),
        });
        editorRef.current = handleRef.current.editor;
        if (!disposed) setReady(true);
      } catch {
        if (!disposed) setFailed(true);
      }
    })();

    return () => {
      disposed = true;
      handleRef.current?.dispose();
      handleRef.current = null;
      editorRef.current = null;
    };
  }, [path, readOnly, attempt]);

  // External value changes (the editor is the only writer otherwise).
  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.getValue() !== value) editor.setValue(value);
  }, [value]);

  // Theme sync (light/dark toggle after boot).
  useEffect(() => {
    if (!ready) return;
    void import('./monaco').then((setup) => setup.applyMonacoTheme(resolvedTheme === 'dark'));
  }, [resolvedTheme, ready]);

  if (failed) {
    return (
      <ErrorState
        bare
        message="Impossible de charger l’éditeur de code."
        onRetry={() => {
          setFailed(false);
          setReady(false);
          setAttempt((n) => n + 1);
        }}
      />
    );
  }

  return (
    <div className="relative h-[60vh] min-h-[320px] overflow-hidden rounded-md border">
      <div ref={containerRef} className="absolute inset-0" />
      {!ready && (
        <div className="pointer-events-none absolute inset-0 flex flex-col gap-2.5 bg-background p-4">
          <Skeleton className="w-1/3" />
          <Skeleton className="w-2/3" />
          <Skeleton className="w-1/2" />
          <Skeleton className="w-3/4" />
          <Skeleton className="w-1/3" />
          <Skeleton className="w-2/3" />
        </div>
      )}
    </div>
  );
}
