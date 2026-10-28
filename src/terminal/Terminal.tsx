import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { TerminalLine } from '../types';
import type { Completion } from './commands';
import { MAX_INPUT_LENGTH, sanitizeInput } from './parser';
import { Icon } from '../ui/Icon';

interface Props {
  creatorName: string;
  /** Transcript, owned by the app so it can be exported, imported and written to by toolbar actions. */
  lines: readonly TerminalLine[];
  /** Previously entered commands (oldest first), for ↑/↓. */
  commands: readonly string[];
  onSubmit: (raw: string) => void;
  onClear: () => void;
  complete: (input: string) => Completion;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export const PLACEHOLDER = 'Type --help to get the commands';

export function Terminal({ creatorName, lines, commands: history, onSubmit, onClear, complete, collapsed, onToggleCollapsed }: Props) {
  const prompt = `${creatorName}@solarsystem ~$`;
  const [input, setInput] = useState('');
  const [suggest, setSuggest] = useState<string[]>([]);
  const historyIndex = useRef<number | null>(null);
  const draft = useRef('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, collapsed]);

  const submit = () => {
    const raw = sanitizeInput(input);
    setInput('');
    setSuggest([]);
    historyIndex.current = null;
    onSubmit(raw);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const c = complete(input);
      setInput(sanitizeInput(c.value));
      setSuggest(c.candidates.length > 1 ? c.candidates.slice(0, 24) : []);
    } else if (e.key === 'Escape') {
      // Dismiss suggestions only; the typed command is kept.
      if (suggest.length) {
        e.preventDefault();
        e.stopPropagation();
        setSuggest([]);
      }
    } else if (e.key === 'ArrowUp') {
      if (!history.length) return;
      e.preventDefault();
      if (historyIndex.current === null) {
        draft.current = input;
        historyIndex.current = history.length - 1;
      } else historyIndex.current = Math.max(0, historyIndex.current - 1);
      setInput(history[historyIndex.current]);
      setSuggest([]);
    } else if (e.key === 'ArrowDown') {
      if (historyIndex.current === null) return;
      e.preventDefault();
      const i = historyIndex.current + 1;
      if (i >= history.length) {
        historyIndex.current = null;
        setInput(draft.current);
      } else {
        historyIndex.current = i;
        setInput(history[i]);
      }
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      onClear();
    }
  };

  return (
    <section className={`section console ${collapsed ? 'is-collapsed' : ''}`} aria-labelledby="console-h">
      <header className="section__head">
        <h2 id="console-h">Console</h2>
        <span className="section__meta console__tty">tty0</span>
        <button
          type="button"
          className="btn-icon btn-icon--sm"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          aria-controls="console-body"
          aria-label={collapsed ? 'Expand console' : 'Collapse console'}
          data-tip={collapsed ? 'Expand' : 'Collapse'}
        >
          <Icon name={collapsed ? 'keyboard_arrow_up' : 'keyboard_arrow_down'} />
        </button>
      </header>
      <div id="console-body" className="console__body" hidden={collapsed} onClick={() => inputRef.current?.focus()}>
        <div className="console__scroll" ref={scrollRef} role="log" aria-live="polite" aria-relevant="additions">
          {lines.map((l) => (
            <div key={l.id} className={`cline cline--${l.kind}`}>
              {l.kind === 'input' && <span className="prompt">{l.prompt} </span>}
              {l.text || ' '}
            </div>
          ))}
        </div>
        {suggest.length > 0 && (
          <div className="console__suggest" role="listbox" aria-label="Completions">
            {suggest.map((s) => (
              <button
                key={s}
                type="button"
                role="option"
                aria-selected={false}
                className="console__chip"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setInput(`${input.slice(0, input.length - lastTokenLength(input))}${/\s/.test(s) ? `"${s}"` : s} `);
                  setSuggest([]);
                  inputRef.current?.focus();
                }}
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <div className="console__input-row">
          <label htmlFor="terminal-input" className="prompt">{prompt}</label>
          <input
            id="terminal-input"
            ref={inputRef}
            className="console__input"
            value={input}
            onChange={(e) => {
              historyIndex.current = null;
              setInput(sanitizeInput(e.target.value));
              if (suggest.length) setSuggest([]);
            }}
            onKeyDown={onKeyDown}
            placeholder={PLACEHOLDER}
            maxLength={MAX_INPUT_LENGTH}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="send"
          />
        </div>
      </div>
    </section>
  );
}

function lastTokenLength(s: string): number {
  const m = /("[^"]*|'[^']*|\S*)$/.exec(s);
  return m ? m[0].length : 0;
}
