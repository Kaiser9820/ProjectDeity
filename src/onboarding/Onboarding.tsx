import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MAX_NAME_LENGTH, validateCreatorName } from '../lib/creatorName';

interface Props {
  initialName?: string;
  mode: 'first-run' | 'rename';
  onConfirm: (name: string) => void;
  onCancel?: () => void;
}

export function Onboarding({ initialName = '', mode, onConfirm, onCancel }: Props) {
  const [name, setName] = useState(initialName);
  const [touched, setTouched] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const result = validateCreatorName(name);
  const showError = touched && !result.ok;

  useEffect(() => inputRef.current?.focus(), []);

  useEffect(() => {
    if (!onCancel) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!result.ok) return inputRef.current?.focus();
    setLeaving(true);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.setTimeout(() => onConfirm(result.value), reduce || mode === 'rename' ? 0 : 650);
  };

  return (
    <div className={`onboarding onboarding--${mode} ${leaving ? 'is-leaving' : ''}`} role="dialog" aria-modal="true" aria-labelledby="onb-title">
      <form className="onboarding__card" onSubmit={submit} noValidate>
        {mode === 'first-run' && (
          <>
          <img className="onboarding__logo" src={`${import.meta.env.BASE_URL}brand/icon-192.png`} alt="" width={56} height={56} />
          <p className="onboarding__eyebrow">Project Deity · Solar System</p>
          </>
        )}
        <h1 id="onb-title" className="onboarding__title">
          {mode === 'first-run' ? 'Before the first light, a name.' : 'Rename your creator'}
        </h1>
        {mode === 'first-run' && (
          <p className="onboarding__lede">
            The Sun and eight planets are set to their positions on 1 January 2026, as given by JPL Horizons.
            Choose the name this universe will answer to. It appears in your console prompt.
          </p>
        )}
        <label htmlFor="creator-name" className="onboarding__label">Creator name</label>
        <div className={`onboarding__field ${showError ? 'has-error' : ''}`}>
          <input
            id="creator-name"
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name && setTouched(true)}
            maxLength={MAX_NAME_LENGTH * 2}
            autoComplete="nickname"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={showError}
            aria-describedby="creator-hint"
          />
          <span className="onboarding__suffix" aria-hidden="true">@solarsystem</span>
        </div>
        <p id="creator-hint" className={`onboarding__hint ${showError ? 'is-error' : ''}`} aria-live="polite">
          {showError && !result.ok ? result.error : `Letters, digits, _ - . · up to ${MAX_NAME_LENGTH} characters`}
          <span className="onboarding__count">{[...name].length}/{MAX_NAME_LENGTH}</span>
        </p>
        <div className="onboarding__actions">
          {onCancel && (
            <button type="button" className="btn btn--ghost" onClick={onCancel}>Cancel</button>
          )}
          <button type="submit" className="btn btn--primary">
            {mode === 'first-run' ? 'Let there be light' : 'Save name'}
            <span className="icon material-symbols-outlined" aria-hidden="true">arrow_forward</span>
          </button>
        </div>
      </form>
    </div>
  );
}
