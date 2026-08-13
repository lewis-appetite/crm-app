'use client';

import { Contact, daysAgo } from '@/lib/sheets';
import styles from '../OutreachApp.module.css';

interface Props {
  contacts: Contact[];
  onReplied: (c: Contact, value: 'Interested' | 'Not interested') => void;
  onMeetingBooked: (c: Contact) => void;
  commentDrafts: Record<number, string>;
  onCommentDraftChange: (rowIndex: number, value: string) => void;
  onSaveComment: (c: Contact) => void;
  onLinkedIn: (c: Contact) => void;
  onDraftEmail: (c: Contact) => void;
  onFindEmail: (c: Contact) => void;
  onCallContact: (c: Contact) => void;
  emailBusy: Record<number, 'enriching' | 'drafting'>;
}

export default function RepliedTab({
  contacts, onReplied, onMeetingBooked,
  commentDrafts, onCommentDraftChange, onSaveComment,
  onLinkedIn, onDraftEmail, onFindEmail, onCallContact, emailBusy,
}: Props) {
  return (
    <div className={styles.todayPage}>
      {contacts.length === 0 ? (
        <div className={styles.emptyState}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
            <polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
          <p>No live conversations right now</p>
        </div>
      ) : contacts.map(c => {
        const initials = `${c.firstName[0] ?? ''}${c.lastName[0] ?? ''}`.toUpperCase();
        const d = daysAgo(c.lastContacted);
        return (
          <div key={c.rowIndex} className={styles.todayContact}>
            <div className={styles.todayContactTop}>
              <div className={styles.todayAvatar}>{initials}</div>
              <div className={styles.todayContactMeta}>
                <div className={styles.todayContactNameRow}>
                  <span className={styles.todayContactName}>{c.fullName}</span>
                  <span className={`${styles.replyBadge} ${styles.replyInterested}`}>{c.reply}</span>
                  <span className={styles.channelIcons}>
                    {c.url && (
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" className={styles.channelIcon} aria-label="Has LinkedIn"><title>LinkedIn</title><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                    )}
                    {c.email && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.channelIcon} aria-label="Has email"><title>Email</title><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/></svg>
                    )}
                    {c.phone && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.channelIcon} aria-label="Has phone number"><title>Phone</title><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.36 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.34 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                    )}
                  </span>
                </div>
                <span className={styles.todayContactSub}>
                  {[c.position, c.company].filter(Boolean).join(' · ')}
                </span>
                <span className={styles.todayContactSub}>
                  {c.lastContacted ? `Last contacted ${c.lastContacted}${d !== null ? ` (${d}d ago)` : ''}` : 'not yet contacted'}
                </span>
              </div>
            </div>

            <div className={styles.todayActionsRow}>
              <button className={`${styles.todayActionBtn} ${styles.todayActionGreen}`} onClick={() => onMeetingBooked(c)}>
                Meeting booked
              </button>
              <button className={styles.todayActionBtn} onClick={() => onReplied(c, 'Not interested')}>
                Not interested
              </button>
              {c.url && (
                <button className={styles.todayChannelBtn} onClick={() => onLinkedIn(c)} aria-label="Open LinkedIn">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                </button>
              )}
              {c.email ? (
                <button
                  className={`${styles.todayChannelBtn} ${styles.emailReadyBtn}`}
                  onClick={() => onDraftEmail(c)}
                  disabled={!!emailBusy[c.rowIndex]}
                  aria-label="Draft email with AI"
                  title="AI-draft an email into your Gmail drafts"
                >
                  {emailBusy[c.rowIndex] === 'drafting' ? (
                    <span className={styles.miniSpinner} />
                  ) : (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/></svg>
                  )}
                </button>
              ) : (
                <button
                  className={styles.todayChannelBtn}
                  onClick={() => onFindEmail(c)}
                  disabled={!!emailBusy[c.rowIndex]}
                  aria-label="Find email with FullEnrich"
                  title="Find this contact's email (uses FullEnrich credits)"
                >
                  {emailBusy[c.rowIndex] === 'enriching' ? (
                    <span className={styles.miniSpinner} />
                  ) : (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="14" height="12" rx="2"/><path d="m16 7-7 4-7-4"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="m21 20 2 2"/></svg>
                  )}
                </button>
              )}
              {c.phone && (
                <button className={styles.todayChannelBtn} onClick={() => onCallContact(c)} aria-label="Call">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.36 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.34 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                </button>
              )}
            </div>

            <div className={styles.todayCommentRow}>
              <input
                className={styles.todayCommentInput}
                placeholder="Add a comment…"
                value={commentDrafts[c.rowIndex] ?? c.comment}
                onChange={e => onCommentDraftChange(c.rowIndex, e.target.value)}
                onKeyDown={e => e.key === 'Enter' && onSaveComment(c)}
              />
              {(commentDrafts[c.rowIndex] ?? c.comment) !== c.comment && (
                <button className={styles.todayCommentSaveBtn} onClick={() => onSaveComment(c)}>Save</button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
