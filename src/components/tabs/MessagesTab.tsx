'use client';

import { useRef, useState } from 'react';
import { Contact, Message, getMessageStats, MessageStats } from '@/lib/sheets';
import styles from '../OutreachApp.module.css';

type MessagesView = 'cards' | 'table';

export default function MessagesTab({ allContacts, messages }: { allContacts: Contact[]; messages: Message[] }) {
  const [messagesView, setMessagesView] = useState<MessagesView>('cards');
  const [copiedMsg, setCopiedMsg] = useState<string | null>(null);
  const msgCopyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleCopyMessage(text: string, abbr: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedMsg(abbr);
      if (msgCopyTimeout.current) clearTimeout(msgCopyTimeout.current);
      msgCopyTimeout.current = setTimeout(() => setCopiedMsg(null), 2000);
    });
  }

  const stats: MessageStats[] = getMessageStats(allContacts, messages);
  const statsMap = Object.fromEntries(stats.map(s => [s.abbreviation, s]));

  // Group by messageType, sorted by reply rate desc within each group
  const groups = Array.from(new Set(messages.map(m => m.messageType))).map(type => ({
    type,
    messages: messages
      .filter(m => m.messageType === type)
      .sort((a, b) => {
        const ra = statsMap[a.abbreviation]?.replyRate ?? -1;
        const rb = statsMap[b.abbreviation]?.replyRate ?? -1;
        return rb - ra;
      }),
  }));

  return (
    <div className={styles.messagesList}>
      {/* View toggle */}
      <div className={styles.viewToggle}>
        <button
          className={`${styles.viewToggleBtn} ${messagesView === 'cards' ? styles.viewToggleActive : ''}`}
          onClick={() => setMessagesView('cards')}
        >Cards</button>
        <button
          className={`${styles.viewToggleBtn} ${messagesView === 'table' ? styles.viewToggleActive : ''}`}
          onClick={() => setMessagesView('table')}
        >Table</button>
      </div>

      {messagesView === 'table' ? (
        <div className={styles.msgTableGroups}>
          {groups.map(({ type, messages: groupMsgs }) => (
            <div key={type} className={styles.msgTableGroup}>
              <div className={styles.msgTableGroupHeader}>{type}</div>
              {groupMsgs.map(msg => {
                const s = statsMap[msg.abbreviation];
                return (
                  <div key={msg.abbreviation} className={styles.msgTableRow}>
                    <span className={styles.msgTableRate}>
                      {s?.replyRate !== null && s?.replyRate !== undefined ? `${s.replyRate}%` : '—'}
                    </span>
                    <span className={styles.msgTableAbbr}>{msg.abbreviation}</span>
                    {s?.sent > 0 && (
                      <span className={styles.msgTableSent}>{s.replied}/{s.sent} sent</span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ) : (
        messages.map((msg, i) => {
          const s = statsMap[msg.abbreviation];
          return (
            <div key={i} className={styles.messageItem}>
              <div className={styles.messageItemHeader}>
                <div className={styles.messageItemMeta}>
                  <span className={styles.messageTypeBadge}>{msg.messageType}</span>
                  <span className={styles.messageTarget}>{msg.target}</span>
                </div>
                <div className={styles.messageItemRight}>
                  {s?.replyRate !== null && s?.replyRate !== undefined && (
                    <span className={styles.ratePill}>{s.replyRate}%</span>
                  )}
                  <span className={styles.messageAbbr}>{msg.abbreviation}</span>
                </div>
              </div>
              {s && s.sent > 0 && (
                <div className={styles.messageSentRow}>
                  {s.replied} positive / {s.sent} sent
                </div>
              )}
              <p className={styles.messageItemBody}>{msg.fullMessage}</p>
              <button
                className={`${styles.copyBtn} ${copiedMsg === msg.abbreviation ? styles.copyBtnDone : ''}`}
                onClick={() => handleCopyMessage(msg.fullMessage, msg.abbreviation)}
              >
                {copiedMsg === msg.abbreviation ? (
                  <><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Copied</>
                ) : (
                  <><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy</>
                )}
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}
