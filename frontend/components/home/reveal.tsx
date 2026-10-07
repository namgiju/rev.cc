'use client';

import {useEffect, useRef, useState, type ReactNode} from 'react';
import styles from './reveal.module.css';

// 카드/사이드바 섹션이 처음 화면에 들어올 때 한 번만 살짝 떠오르는 공용 래퍼.
// IntersectionObserver로 한 번 보이면 바로 unobserve하므로 스크롤을 오가도
// 다시 실행되지 않는다. prefers-reduced-motion이면 관찰 자체를 생략한다.
export default function Reveal({
  children,
  className = '',
  delayMs = 0,
}: {
  children: ReactNode;
  className?: string;
  delayMs?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      {threshold: 0.15},
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`${styles.reveal} ${visible ? styles.visible : ''} ${className}`}
      style={{transitionDelay: visible ? `${delayMs}ms` : '0ms'}}
    >
      {children}
    </div>
  );
}
