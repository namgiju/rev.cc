import PasswordResetForm from '../../components/auth/password-reset-form';

export const metadata = {title: '비밀번호 재설정'};

// /password-reset — same URL as the legacy page (nginx still serves the
// legacy one until the routing switch in NOW-3). No `?next=` handling —
// the legacy page doesn't have any.
export default function Page() {
  return <PasswordResetForm />;
}
