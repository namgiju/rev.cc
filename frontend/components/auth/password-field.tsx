'use client';

import type {Ref} from 'react';
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
  inputRef,
  required = true,
  disabled = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  shown: boolean;
  onToggle: () => void;
  autoComplete: string;
  placeholder: string;
  inputRef?: Ref<HTMLInputElement>;
  required?: boolean;
  disabled?: boolean;
}) {
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <div className={styles.passwordField}>
        <input
          id={id}
          ref={inputRef}
          type={shown ? 'text' : 'password'}
          autoComplete={autoComplete}
          maxLength={255}
          required={required}
          disabled={disabled}
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
