'use client';

import {useEffect, useRef, useState, type FormEvent} from 'react';
import {updateMemberProfile, uploadImage} from '../../lib/community-api';
import type {CommunityMember} from '../../lib/community-types';
import styles from './my-garage.module.css';

// Profile settings (formerly home.js's editProfile() panel): one-line bio,
// avatar and cover image, each replaceable or removable. No new API —
// PUT /api/board/profile (STEP 3-0) with the same precedence as the legacy
// form: a newly picked file wins, otherwise the remove checkbox, otherwise
// the existing image stays.
export default function ProfileEditDialog({
  member,
  onClose,
  onSaved,
}: {
  member: CommunityMember;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [removeCover, setRemoveCover] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const avatarImageId = avatarFile ? await uploadImage(avatarFile) : removeAvatar ? null : member.avatarImageId ?? null;
      const coverImageId = coverFile ? await uploadImage(coverFile) : removeCover ? null : member.coverImageId ?? null;
      await updateMemberProfile({bio: String(form.get('bio') || '').trim(), avatarImageId, coverImageId});
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '프로필을 저장하지 못했어요.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="profile-edit-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <h2 id="profile-edit-title">프로필 수정</h2>
      <form onSubmit={submit}>
        <label>
          한 줄 소개
          <textarea name="bio" defaultValue={member.bio ?? ''} maxLength={300} rows={3} disabled={busy} />
        </label>
        <label>
          프로필 이미지
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={(e) => setAvatarFile(e.target.files?.[0] ?? null)}
          />
        </label>
        {member.avatarImageId != null && (
          <label>
            <input type="checkbox" checked={removeAvatar} onChange={(e) => setRemoveAvatar(e.target.checked)} disabled={busy} /> 기존 프로필
            이미지 제거
          </label>
        )}
        <label>
          커버 이미지
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={(e) => setCoverFile(e.target.files?.[0] ?? null)}
          />
        </label>
        {member.coverImageId != null && (
          <label>
            <input type="checkbox" checked={removeCover} onChange={(e) => setRemoveCover(e.target.checked)} disabled={busy} /> 기존 커버
            이미지 제거
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
          <button type="submit" className={styles.primary} disabled={busy}>
            {busy ? '저장 중…' : '프로필 저장'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
