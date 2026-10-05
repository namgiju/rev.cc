'use client';

import styles from './auth.module.css';

// Password input with the legacy 보기/숨기기 toggle (auth.js [data-password]).
export default function PasswordField({
  id,
  label,
  value,
  onChange,
  shown,
  onToggle,
  autoComplete,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  shown: boolean;
  onToggle: () => void;
  autoComplete: string;
  placeholder: string;
}) {
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <div className={styles.passwordField}>
        <input
          id={id}
          type={shown ? 'text' : 'password'}
          autoComplete={autoComplete}
          maxLength={255}
          required
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className={styles.toggle}
          aria-pressed={shown}
          aria-label={`${label} ${shown ? '숨기기' : '표시'}`}
          onClick={onToggle}
        >
          {shown ? '숨기기' : '보기'}
        </button>
      </div>
    </>
  );
}
