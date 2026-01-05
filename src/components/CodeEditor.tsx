import { useRef, useEffect } from 'react';
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { javascript, javascriptLanguage } from '@codemirror/lang-javascript';
import { python, pythonLanguage } from '@codemirror/lang-python';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting, HighlightStyle, bracketMatching, indentOnInput, LanguageSupport, StreamLanguage } from '@codemirror/language';
import { haskell as haskellLegacy } from '@codemirror/legacy-modes/mode/haskell';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { lintKeymap } from '@codemirror/lint';
import { tags } from '@lezer/highlight';
import { cn } from '@/lib/utils';

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language: string;
  className?: string;
}

const racketSupport = (): LanguageSupport => {
  const racketKeywords = 'define lambda let if cond else and or not quote list cons car cdr null? hash-ref hash-set map filter fold begin display newline';
  
  return new LanguageSupport(
    javascriptLanguage,
    []
  );
};

const customHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: '#c792ea' },
  { tag: tags.function(tags.variableName), color: '#82aaff' },
  { tag: tags.variableName, color: '#eeffff' },
  { tag: tags.string, color: '#c3e88d' },
  { tag: tags.number, color: '#f78c6c' },
  { tag: tags.bool, color: '#ff5370' },
  { tag: tags.null, color: '#ff5370' },
  { tag: tags.operator, color: '#89ddff' },
  { tag: tags.comment, color: '#546e7a', fontStyle: 'italic' },
  { tag: tags.className, color: '#ffcb6b' },
  { tag: tags.typeName, color: '#ffcb6b' },
  { tag: tags.propertyName, color: '#89ddff' },
  { tag: tags.bracket, color: '#89ddff' },
]);

const getLanguageExtension = (language: string) => {
  switch (language) {
    case 'javascript':
      return javascript();
    case 'typescript':
      return javascript({ typescript: true });
    case 'python':
      return python();
    case 'rustpython':
      return python();
    case 'racket':
      return racketSupport();
    case 'haskell':
      return StreamLanguage.define(haskellLegacy);
    default:
      return javascript();
  }
};

export function CodeEditor({ value, onChange, language, className }: CodeEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const languageCompartment = useRef(new Compartment());

  useEffect(() => {
    if (!editorRef.current) return;

    const startState = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        bracketMatching(),
        closeBrackets(),
        indentOnInput(),
        highlightSelectionMatches(),
        autocompletion(),
        syntaxHighlighting(customHighlightStyle),
        languageCompartment.current.of(getLanguageExtension(language)),
        keymap.of([
          ...defaultKeymap,
          ...closeBracketsKeymap,
          ...searchKeymap,
          ...completionKeymap,
          ...lintKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const newValue = update.state.doc.toString();
            onChange(newValue);
          }
        }),
        EditorView.theme({
          '&': {
            height: '100%',
            fontSize: '14px',
            fontFamily: 'var(--font-mono)',
          },
          '.cm-scroller': {
            overflow: 'auto',
            fontFamily: 'var(--font-mono)',
          },
          '.cm-content': {
            caretColor: 'oklch(0.75 0.15 195)',
            fontFamily: 'var(--font-mono)',
          },
          '.cm-cursor': {
            borderLeftColor: 'oklch(0.75 0.15 195)',
          },
          '&.cm-focused .cm-cursor': {
            borderLeftColor: 'oklch(0.75 0.15 195)',
          },
          '&.cm-focused .cm-selectionBackground, ::selection': {
            backgroundColor: 'oklch(0.35 0.01 250)',
          },
          '.cm-activeLine': {
            backgroundColor: 'oklch(0.18 0.01 250)',
          },
          '.cm-activeLineGutter': {
            backgroundColor: 'oklch(0.18 0.01 250)',
          },
          '.cm-gutters': {
            backgroundColor: 'oklch(0.12 0.01 250)',
            color: 'oklch(0.65 0.01 250)',
            border: 'none',
            fontFamily: 'var(--font-mono)',
          },
        }),
        EditorView.lineWrapping,
      ],
    });

    const view = new EditorView({
      state: startState,
      parent: editorRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
    };
  }, []);

  useEffect(() => {
    if (viewRef.current && value !== undefined) {
      const currentValue = viewRef.current.state.doc.toString();
      if (currentValue !== value) {
        viewRef.current.dispatch({
          changes: {
            from: 0,
            to: currentValue.length,
            insert: value,
          },
        });
      }
    }
  }, [value]);

  useEffect(() => {
    if (viewRef.current) {
      viewRef.current.dispatch({
        effects: languageCompartment.current.reconfigure(getLanguageExtension(language)),
      });
    }
  }, [language]);

  return (
    <div className={cn('h-full overflow-hidden rounded-lg border border-border', className)}>
      <div ref={editorRef} className="h-full" id="code-editor" />
    </div>
  );
}
