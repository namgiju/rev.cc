import {Suspense} from 'react';
import SignupForm from '../../components/auth/signup-form';

export const metadata = {title: '회원가입'};

// /signup — same URL as the legacy page (nginx still serves the legacy one
// until the routing switch in NOW-3). `?next=` is read on the client.
export default function Page() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}
