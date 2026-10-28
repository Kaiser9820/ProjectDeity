import { Icon } from './Icon';

export interface ToastMessage {
  id: number;
  kind: 'success' | 'error' | 'info';
  text: string;
}

/** Transient feedback. Polite live region, so screen readers announce it without stealing focus. */
export function Toast({ toast, onDismiss }: { toast: ToastMessage | null; onDismiss: () => void }) {
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {toast && (
        <div key={toast.id} className={`toast toast--${toast.kind}`}>
          <Icon name={toast.kind === 'error' ? 'error' : toast.kind === 'success' ? 'check_circle' : 'info'} />
          <span>{toast.text}</span>
          <button type="button" className="btn-icon btn-icon--sm" onClick={onDismiss} aria-label="Dismiss">
            <Icon name="close" />
          </button>
        </div>
      )}
    </div>
  );
}
