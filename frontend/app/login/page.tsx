import {Suspense} from 'react';
import LoginForm from '../../components/auth/login-form';

export const metadata = {title: '로그인'};

// /login — same URL as the legacy page (nginx still serves the legacy one
// until the routing switch in NOW-3). `?next=` and `?joined=1`/`?reset=1`
// are read on the client.
export default function Page() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
