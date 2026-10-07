import type {ReactNode} from 'react';
import Logo from '../common/logo';
import styles from './auth.module.css';

// Centered card shared by /login (and later /signup, /password-reset):
// assignment-frontend/auth/index.html's .auth-shell / .auth-panel.
export default function AuthShell({title, description, children}: {title: string; description: ReactNode; children: ReactNode}) {
  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="auth-title">
        <a href="/" className={styles.logo} aria-label="morethancar 홈">
          <Logo height={30} />
        </a>
        <p className={styles.eyebrow}>DRIVE · SHARE · CONNECT</p>
        <h1 id="auth-title">{title}</h1>
        <p className={styles.description}>{description}</p>
        {children}
        <p className={styles.copyright}>© 2026 morethancar · 차, 그 이상.</p>
      </section>
    </main>
  );
}
