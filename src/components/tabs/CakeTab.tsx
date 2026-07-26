'use client';

import { useRef, useState } from 'react';
import styles from '../OutreachApp.module.css';

const CAKE_PROMPT = `I'm generating images of cakes for marketing outreach campaigns. Replace the cake topper image with a photo image of the brand provided. Content of the photo image are: Brand logo top and centre. Then the marketing headline central to the cake. Then client logo's (if any provided) underneath - if no client logos provided then do not make these up. Then bottom left is a placeholder QR code. Bottom right is placeholder contact details (email, phone, website). Cake top background should reflect that of the brand image provided, ensuring the photo is not a completely flat colour - it needs to look like a photo printed on a cake topper, not a badly photoshopped image stuck on.`;

export default function CakeTab() {
  const [copiedCake, setCopiedCake] = useState(false);
  const cakeCopyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  return (
    <div className={styles.cakePage}>
      <div className={styles.cakeCard}>
        <div className={styles.cakeCardTitle}>ChatGPT prompt</div>
        <p className={styles.cakePromptText}>{CAKE_PROMPT}</p>
        <button
          className={`${styles.copyBtn} ${copiedCake ? styles.copyBtnDone : ''}`}
          onClick={() => {
            navigator.clipboard.writeText(CAKE_PROMPT).then(() => {
              setCopiedCake(true);
              if (cakeCopyTimeout.current) clearTimeout(cakeCopyTimeout.current);
              cakeCopyTimeout.current = setTimeout(() => setCopiedCake(false), 2000);
            });
          }}
        >
          {copiedCake ? (
            <><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Copied</>
          ) : (
            <><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy prompt</>
          )}
        </button>
      </div>

      <div className={styles.cakeCard}>
        <div className={styles.cakeCardTitle}>Cake topper template</div>
        <p className={styles.cakeHint}>Upload this image alongside the prompt and a screenshot of the contact's website into ChatGPT.</p>
        <a
          className={styles.cakeTemplateBtn}
          href="https://drive.google.com/file/d/1ABzTiKcqTw8UfkEVXvFt7-yM1zxxY81K/view?usp=sharing"
          target="_blank"
          rel="noopener noreferrer"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Open template in Drive
        </a>
      </div>
    </div>
  );
}
