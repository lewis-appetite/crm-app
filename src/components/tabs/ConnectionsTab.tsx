'use client';

import { useState } from 'react';
import { Contact, daysAgo, POSITIVE_REPLIES } from '@/lib/sheets';
import styles from '../OutreachApp.module.css';

const REPLY_OPTIONS = ['', 'Interested', 'Yes', 'Referred', 'Opportunity', 'Dead lead', 'Wrong location', 'Wrong role', 'Wrong business', 'Not interested', 'Blocked', 'Gone cold'];

interface Props {
  allContacts: Contact[];
  messageAbbrs: string[];
  intervalDays: number;
  editingRowIndex: number | null;
  editValues: Record<string, string>;
  saveLoading: boolean;
  onOpenEdit: (c: Contact) => void;
  onCloseEdit: () => void;
  onEditValueChange: (field: string, value: string) => void;
  onSaveEdit: () => void;
}

export default function ConnectionsTab({
  allContacts, messageAbbrs, intervalDays,
  editingRowIndex, editValues, saveLoading,
  onOpenEdit, onCloseEdit, onEditValueChange, onSaveEdit,
}: Props) {
  const [search, setSearch] = useState('');
  const [filterList, setFilterList] = useState('');
  const [filterFunction, setFilterFunction] = useState('');
  const [filterReply, setFilterReply] = useState('');

  const lists = Array.from(new Set(allContacts.map(c => c.list).filter(Boolean))).sort();
  const functions = Array.from(new Set(allContacts.map(c => c.function).filter(Boolean))).sort();
  const replies = Array.from(new Set(allContacts.map(c => c.reply).filter(Boolean))).sort();

  const filtered = allContacts.filter(c => {
    if (filterList && c.list !== filterList) return false;
    if (filterFunction && c.function !== filterFunction) return false;
    if (filterReply && c.reply !== filterReply) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!c.fullName.toLowerCase().includes(q) && !c.company.toLowerCase().includes(q) && !c.position.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  return (
    <div className={styles.connectionsList}>
      <input className={styles.searchInput} type="search" placeholder="Search name, company, position…" value={search} onChange={e => setSearch(e.target.value)} />
      <div className={styles.filterRow}>
        <select className={styles.filterSelect} value={filterList} onChange={e => setFilterList(e.target.value)}>
          <option value="">All lists</option>
          {lists.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <select className={styles.filterSelect} value={filterFunction} onChange={e => setFilterFunction(e.target.value)}>
          <option value="">All functions</option>
          {functions.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <select className={styles.filterSelect} value={filterReply} onChange={e => setFilterReply(e.target.value)}>
          <option value="">All replies</option>
          {replies.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      <div className={styles.filterCount}>{filtered.length} contact{filtered.length !== 1 ? 's' : ''}</div>
      {filtered.map(c => {
        const isEditing = editingRowIndex === c.rowIndex;
        const cDays = daysAgo(c.lastContacted);
        const isOverdue = cDays !== null && cDays >= intervalDays && !!c.message && !c.reply;
        return (
          <div key={c.rowIndex} className={styles.connectionItem}>
            <div className={styles.connectionRow} onClick={() => isEditing ? onCloseEdit() : onOpenEdit(c)}>
              <div className={styles.connectionMain}>
                <span className={styles.connectionName}>{c.fullName}</span>
                <span className={styles.connectionCompany}>{[c.position, c.company].filter(Boolean).join(' · ')}</span>
                {c.list && <span className={styles.connectionList}>{c.list}</span>}
              </div>
              <div className={styles.connectionMeta}>
                {c.reply ? (
                  <span className={`${styles.replyBadge} ${POSITIVE_REPLIES.includes(c.reply.toLowerCase()) ? styles.replyInterested : styles.replyOther}`}>
                    {c.reply}
                  </span>
                ) : isOverdue ? (
                  <span className={styles.overdueBadge}>overdue</span>
                ) : c.lastContacted ? (
                  <span className={styles.connectionDate}>{c.lastContacted}</span>
                ) : (
                  <span className={styles.connectionNew}>new</span>
                )}
                <svg className={`${styles.expandIcon} ${isEditing ? styles.expandIconOpen : ''}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </div>
            </div>
            {isEditing && (
              <div className={styles.editForm}>
                {[
                  { key: 'list', label: 'List' },
                  { key: 'function', label: 'Function' },
                  { key: 'lastContacted', label: 'Last Contacted' },
                  { key: 'comment', label: 'Comment' },
                ].map(({ key, label }) => (
                  <div key={key} className={styles.editField}>
                    <label className={styles.editLabel}>{label}</label>
                    <input
                      className={styles.editInput}
                      value={editValues[key] ?? ''}
                      onChange={e => onEditValueChange(key, e.target.value)}
                    />
                  </div>
                ))}
                <div className={styles.editField}>
                  <label className={styles.editLabel}>Reply</label>
                  <select className={styles.editInput} value={editValues.reply ?? ''} onChange={e => onEditValueChange('reply', e.target.value)}>
                    {REPLY_OPTIONS.map(r => <option key={r} value={r}>{r || '—'}</option>)}
                  </select>
                </div>
                <div className={styles.editField}>
                  <label className={styles.editLabel}>Message</label>
                  <select className={styles.editInput} value={editValues.message ?? ''} onChange={e => onEditValueChange('message', e.target.value)}>
                    <option value="">—</option>
                    {messageAbbrs.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
                <div className={styles.editField}>
                  <label className={styles.editLabel}>Follow Up 1</label>
                  <select className={styles.editInput} value={editValues.followUpMessage1 ?? ''} onChange={e => onEditValueChange('followUpMessage1', e.target.value)}>
                    <option value="">—</option>
                    {messageAbbrs.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
                <div className={styles.editField}>
                  <label className={styles.editLabel}>Follow Up 2</label>
                  <select className={styles.editInput} value={editValues.followUpMessage2 ?? ''} onChange={e => onEditValueChange('followUpMessage2', e.target.value)}>
                    <option value="">—</option>
                    {messageAbbrs.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
                <div className={styles.editActions}>
                  <button className={styles.editCancelBtn} onClick={onCloseEdit}>Cancel</button>
                  <button className={styles.editSaveBtn} onClick={onSaveEdit} disabled={saveLoading}>
                    {saveLoading ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
