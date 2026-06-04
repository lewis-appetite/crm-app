'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Contact, Message, SuggestedMessage, suggestMessage, daysAgo, todayISO } from '@/lib/sheets';
import styles from './OutreachApp.module.css';

interface SheetData {
  followUps: Contact[];
  newContacts: Contact[];
  messages: Message[];
  allContacts: Contact[];
  intervalDays: number;
}

type Tab = 'followup' | 'new';

export default function OutreachApp() {
  const [data, setData] = useState<SheetData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('followup');
  const [index, setIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/sheet');
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json);
      setIndex(0);
      setDismissed(new Set());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Reset copied state whenever the visible contact changes
  useEffect(() => {
    setCopied(false);
    if (copyTimeout.current) clearTimeout(copyTimeout.current);
  }, [index, tab, dismissed]);

  const queue = data
    ? (tab === 'followup' ? data.followUps : data.newContacts).filter(
        c => !dismissed.has(c.rowIndex)
      )
    : [];

  const safeIndex = Math.min(index, Math.max(0, queue.length - 1));
  const contact = queue[safeIndex] ?? null;

  const suggestion: SuggestedMessage | null =
    contact && data
      ? suggestMessage(contact, data.allContacts, data.messages, tab === 'followup')
      : null;

  async function updateSheet(rowIndex: number, action: 'contacted' | 'dead' | 'visited') {
    try {
      await fetch('/api/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowIndex, action, date: todayISO() }),
      });
    } catch {
      // silent fail — UI already updated optimistically
    }
  }

  function handleLinkedIn(contact: Contact) {
    if (!contact.url) return;
    updateSheet(contact.rowIndex, 'visited');
    window.open(contact.url, '_blank');
  }

  async function handleAction(action: 'contacted' | 'dead') {
    if (!contact || actionLoading) return;
    setActionLoading(true);
    await updateSheet(contact.rowIndex, action);
    setDismissed(prev => new Set(prev).add(contact.rowIndex));
    // Move to next, or stay at current index if queue shrinks
    const newQueue = queue.filter(c => c.rowIndex !== contact.rowIndex);
    setIndex(i => Math.min(i, Math.max(0, newQueue.length - 1)));
    setActionLoading(false);
  }

  function handleCopy() {
    if (!suggestion?.fullMessage) return;
    navigator.clipboard.writeText(suggestion.fullMessage).then(() => {
      setCopied(true);
      if (copyTimeout.current) clearTimeout(copyTimeout.current);
      copyTimeout.current = setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleTabSwitch(t: Tab) {
    setTab(t);
    setIndex(0);
  }

  const days = contact ? daysAgo(contact.lastContacted) : null;
  const intervalDays = data?.intervalDays ?? 14;
  const overdueBy = days !== null ? days - intervalDays : null;

  const initials = contact
    ? `${contact.firstName[0] ?? ''}${contact.lastName[0] ?? ''}`.toUpperCase()
    : '';

  if (loading) {
    return (
      <div className={styles.shell}>
        <div className={styles.loadingState}>
          <div className={styles.spinner} />
          <span>Loading contacts…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.shell}>
        <div className={styles.errorState}>
          <p className={styles.errorTitle}>Could not load sheet</p>
          <p className={styles.errorMsg}>{error}</p>
          <button className={styles.retryBtn} onClick={load}>Try again</button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerTop}>
          <span className={styles.appName}>Outreach</span>
          <button className={styles.refreshBtn} onClick={load} title="Refresh">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
              <path d="M21 3v5h-5"/>
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
              <path d="M8 16H3v5"/>
            </svg>
          </button>
        </div>
        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${tab === 'followup' ? styles.tabActive : ''}`}
            onClick={() => handleTabSwitch('followup')}
          >
            Follow-ups
            <span className={styles.tabCount}>
              {data ? data.followUps.filter(c => !dismissed.has(c.rowIndex)).length : 0}
            </span>
          </button>
          <button
            className={`${styles.tab} ${tab === 'new' ? styles.tabActive : ''}`}
            onClick={() => handleTabSwitch('new')}
          >
            New contacts
            <span className={styles.tabCount}>
              {data ? data.newContacts.filter(c => !dismissed.has(c.rowIndex)).length : 0}
            </span>
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className={styles.main}>
        {queue.length === 0 ? (
          <div className={styles.emptyState}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
              <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
            <p>Queue is clear</p>
          </div>
        ) : (
          <>
            {/* Contact card */}
            <div className={styles.card}>
              <div className={styles.cardTop}>
                <div className={styles.avatar}>{initials}</div>
                <div className={styles.contactInfo}>
                  <div className={styles.contactName}>{contact!.fullName}</div>
                  <div className={styles.contactMeta}>
                    {contact!.position}
                    {contact!.company && <> · <span>{contact!.company}</span></>}
                  </div>
                </div>
                <a
                  className={`${styles.liBtn} ${!contact!.url ? styles.disabled : ''}`}
                  onClick={() => contact!.url && handleLinkedIn(contact!)}
                  role="button"
                  aria-label="Open LinkedIn profile"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                  </svg>
                  Profile
                </a>
              </div>

              <div className={styles.cardDetails}>
                {contact!.function && (
                  <div className={styles.detailRow}>
                    <span className={styles.detailLabel}>Function</span>
                    <span className={styles.detailValue}>{contact!.function}</span>
                  </div>
                )}
                <div className={styles.detailRow}>
                  <span className={styles.detailLabel}>Last contacted</span>
                  <span className={styles.detailValue}>
                    {contact!.lastContacted || 'Never'}
                    {overdueBy !== null && overdueBy > 0 && (
                      <span className={styles.overdueBadge}>+{overdueBy}d overdue</span>
                    )}
                  </span>
                </div>
                {contact!.reply && (
                  <div className={styles.detailRow}>
                    <span className={styles.detailLabel}>Reply</span>
                    <span className={styles.detailValue}>{contact!.reply}</span>
                  </div>
                )}
                {contact!.comment && (
                  <div className={styles.detailRow}>
                    <span className={styles.detailLabel}>Note</span>
                    <span className={`${styles.detailValue} ${styles.noteValue}`}>{contact!.comment}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Message suggestion */}
            {suggestion ? (
              <div className={styles.msgCard}>
                <div className={styles.msgHeader}>
                  <span className={styles.msgLabel}>Suggested message</span>
                  <div className={styles.msgMeta}>
                    {suggestion.replyRate !== null && (
                      <span className={styles.ratePill}>{suggestion.replyRate}% reply rate</span>
                    )}
                    <span className={styles.templateName}>{suggestion.abbreviation}</span>
                  </div>
                </div>
                <p className={styles.msgBody}>{suggestion.fullMessage}</p>
                <button
                  className={`${styles.copyBtn} ${copied ? styles.copyBtnDone : ''}`}
                  onClick={handleCopy}
                >
                  {copied ? (
                    <>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                      Copied
                    </>
                  ) : (
                    <>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                      </svg>
                      Copy message
                    </>
                  )}
                </button>
              </div>
            ) : (
              <div className={styles.msgCard}>
                <p className={styles.noTemplate}>No template assigned — check the sheet.</p>
              </div>
            )}

            {/* Navigation */}
            <div className={styles.navRow}>
              <button
                className={styles.navBtn}
                onClick={() => setIndex(i => Math.max(0, i - 1))}
                disabled={safeIndex === 0}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6"/>
                </svg>
                Prev
              </button>
              <span className={styles.navCount}>{safeIndex + 1} / {queue.length}</span>
              <button
                className={styles.navBtn}
                onClick={() => setIndex(i => Math.min(queue.length - 1, i + 1))}
                disabled={safeIndex >= queue.length - 1}
              >
                Next
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </button>
            </div>

            {/* Actions */}
            <div className={styles.actionRow}>
              <button
                className={`${styles.actionBtn} ${styles.contactedBtn}`}
                onClick={() => handleAction('contacted')}
                disabled={actionLoading}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                Contacted
              </button>
              <button
                className={`${styles.actionBtn} ${styles.deadBtn}`}
                onClick={() => handleAction('dead')}
                disabled={actionLoading}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
                Dead lead
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
