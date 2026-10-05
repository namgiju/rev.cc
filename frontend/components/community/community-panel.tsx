'use client';

import {useEffect, useRef, type ReactNode} from 'react';
import styles from './post-detail.module.css';

// Modal list panel (assignment-frontend's #panel-dialog): a title bar with a
// close button and free content. Esc, the ✕ button and a backdrop click close it.
export default function CommunityPanel({title, onClose, children}: {title: string; onClose: () => void; children: ReactNode}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`${styles.dialog} ${styles.panel}`}
      aria-labelledby="community-panel-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.panelBar}>
        <h2 id="community-panel-title">{title}</h2>
        <button type="button" className={styles.panelClose} aria-label="창 닫기" onClick={onClose}>
          ✕
        </button>
      </div>
      {children}
    </dialog>
  );
}
