'use client';

import {useEffect, useRef, useState, type FormEvent} from 'react';
import styles from './post-detail.module.css';

// Modal used by the post detail page for every confirm / reason prompt:
// - confirm: assignment-frontend's #confirm-dialog (own post/comment delete)
// - reason:  report form (openReport) and the admin moderation form
//            (requestContentDeletion), both a required textarea.
// The action runs inside the dialog: while it's in flight the dialog can't be
// closed or resubmitted, and a failure keeps it open with the server message.
export type DialogSpec =
  | {
      kind: 'confirm';
      title: string;
      message: string;
      confirmLabel: string;
      onConfirm: () => Promise<void>;
    }
  | {
      kind: 'reason';
      title: string;
      description?: string;
      label: string;
      placeholder?: string;
      emptyError: string;
      submitLabel: string;
      danger?: boolean;
      onSubmit: (reason: string) => Promise<void>;
    };

export default function CommunityDialog({spec, onClose}: {spec: DialogSpec; onClose: () => void}) {
  const ref = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    inputRef.current?.focus();
  }, []);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '요청을 처리하지 못했어요.');
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (spec.kind === 'confirm') return void run(spec.onConfirm);
    const value = reason.trim();
    if (!value) {
      setError(spec.emptyError);
      inputRef.current?.focus();
      return;
    }
    void run(() => spec.onSubmit(value));
  }

  const danger = spec.kind === 'confirm' || spec.danger;
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby="community-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form onSubmit={submit}>
        <h2 id="community-dialog-title">{spec.title}</h2>
        {spec.kind === 'confirm' ? <p>{spec.message}</p> : spec.description && <p>{spec.description}</p>}
        {spec.kind === 'reason' && (
          <label>
            {spec.label}
            <textarea
              ref={inputRef}
              name="reason"
              maxLength={500}
              rows={4}
              placeholder={spec.placeholder}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        )}
        {error && (
          <p className={styles.dialogError} role="alert">
            {error}
          </p>
        )}
        <div className={styles.dialogActions}>
          <button type="button" className={styles.dialogCancel} disabled={busy} onClick={onClose}>
            취소
          </button>
          <button type="submit" className={danger ? styles.dialogDanger : styles.primary} disabled={busy}>
            {busy ? '처리 중…' : spec.kind === 'confirm' ? spec.confirmLabel : spec.submitLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
