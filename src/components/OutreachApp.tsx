'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Contact, Message, SuggestedMessage,
  suggestMessage, daysAgo, parseDate, todayDMY,
  getMessageStats, MessageStats, POSITIVE_REPLIES,
} from '@/lib/sheets';
import styles from './OutreachApp.module.css';

interface SheetData {
  followUps: Contact[];
  newContacts: Contact[];
  messages: Message[];
  allContacts: Contact[];
  intervalDays: number;
}

type Tab = 'followup' | 'new' | 'messages' | 'connections';
type NewSort = 'recent' | 'oldest' | 'az';
type MessagesView = 'cards' | 'table';

const REPLY_OPTIONS = ['', 'Interested', 'Yes', 'Referred', 'Opportunity', 'Dead lead', 'Not interested', 'Blocked', 'Gone cold'];

export default function OutreachApp() {
  const [data, setData] = useState<SheetData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('followup');
  const [index, setIndex] = useState(0);

  // Connections tab filters
  const [search, setSearch] = useState('');
  const [filterList, setFilterList] = useState('');
  const [filterFunction, setFilterFunction] = useState('');
  const [filterReply, setFilterReply] = useState('');

  const [messagesView, setMessagesView] = useState<MessagesView>('cards');

  // New contacts sort + filter
  const [newSort, setNewSort] = useState<NewSort>('recent');
  const [newFilterList, setNewFilterList] = useState('');
  const [newFilterFunction, setNewFilterFunction] = useState('');

  // Message picker on contact card
  const [selectedMessage, setSelectedMessage] = useState('');

  // All tab inline edit
  const [editingRowIndex, setEditingRowIndex] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [saveLoading, setSaveLoading] = useState(false);

  const [copied, setCopied] = useState(false);
  const [copiedMsg, setCopiedMsg] = useState<string | null>(null);
  const msgCopyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  useEffect(() => {
    setCopied(false);
    setSelectedMessage('');
    if (copyTimeout.current) clearTimeout(copyTimeout.current);
  }, [index, tab, dismissed]);

  // Sorted + filtered new contacts queue
  const sortedNewContacts = (() => {
    if (!data) return [];
    return data.newContacts
      .filter(c => {
        if (newFilterList && c.list !== newFilterList) return false;
        if (newFilterFunction && c.function !== newFilterFunction) return false;
        return true;
      })
      .sort((a, b) => {
        if (newSort === 'az') return a.fullName.localeCompare(b.fullName);
        const da = parseDate(a.connectedOn);
        const db = parseDate(b.connectedOn);
        if (!da || !db) return 0;
        return newSort === 'recent'
          ? db.getTime() - da.getTime()
          : da.getTime() - db.getTime();
      });
  })();

  const queue = data
    ? (tab === 'followup' ? data.followUps : sortedNewContacts).filter(
        c => !dismissed.has(c.rowIndex)
      )
    : [];

  const safeIndex = Math.min(index, Math.max(0, queue.length - 1));
  const contact = queue[safeIndex] ?? null;

  const suggestion: SuggestedMessage | null =
    contact && data
      ? suggestMessage(contact, data.allContacts, data.messages, tab === 'followup')
      : null;

  const isSecondFollowUp = tab === 'followup' && !!contact?.followUpMessage1;

  const messageOptions = data?.messages.filter(m =>
    tab === 'new'
      ? m.messageType === 'Initial Outreach'
      : m.messageType === 'Follow Up'
  ) ?? [];

  async function updateSheet(rowIndex: number, cells: { col: string; value: string }[]) {
    try {
      await fetch('/api/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowIndex, cells }),
      });
    } catch {
      // silent fail — UI already updated optimistically
    }
  }

  function handleLinkedIn(c: Contact) {
    if (!c.url) return;
    updateSheet(c.rowIndex, [{ col: 'N', value: todayDMY() }]);
    window.open(c.url, '_blank');
  }

  async function handleAction(action: 'contacted' | 'dead') {
    if (!contact || actionLoading) return;
    setActionLoading(true);

    const cells: { col: string; value: string }[] = [];

    if (action === 'contacted') {
      if (selectedMessage) {
        if (tab === 'new') cells.push({ col: 'I', value: selectedMessage });
        else if (isSecondFollowUp) cells.push({ col: 'M', value: selectedMessage });
        else cells.push({ col: 'L', value: selectedMessage });
      }
      cells.push({ col: 'N', value: todayDMY() });
    } else {
      cells.push({ col: 'J', value: 'Dead lead' });
    }

    await updateSheet(contact.rowIndex, cells);
    setDismissed(prev => new Set(prev).add(contact.rowIndex));
    const newQueue = queue.filter(c => c.rowIndex !== contact.rowIndex);
    setIndex(i => Math.min(i, Math.max(0, newQueue.length - 1)));
    setSelectedMessage('');
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

  function handleCopyMessage(text: string, abbr: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedMsg(abbr);
      if (msgCopyTimeout.current) clearTimeout(msgCopyTimeout.current);
      msgCopyTimeout.current = setTimeout(() => setCopiedMsg(null), 2000);
    });
  }

  function handleTabSwitch(t: Tab) {
    setTab(t);
    setIndex(0);
    setEditingRowIndex(null);
  }

  function openEdit(c: Contact) {
    setEditingRowIndex(c.rowIndex);
    setEditValues({
      list: c.list,
      function: c.function,
      message: c.message,
      reply: c.reply,
      followUpMessage1: c.followUpMessage1,
      followUpMessage2: c.followUpMessage2,
      lastContacted: c.lastContacted,
      comment: c.comment,
    });
  }

  async function saveEdit() {
    if (editingRowIndex === null || saveLoading) return;
    setSaveLoading(true);

    const fieldCols: Record<string, string> = {
      list: 'F', function: 'G', message: 'I', reply: 'J',
      followUpMessage1: 'L', followUpMessage2: 'M', lastContacted: 'N', comment: 'O',
    };

    const cells = Object.entries(editValues).map(([field, value]) => ({
      col: fieldCols[field],
      value,
    }));

    await updateSheet(editingRowIndex, cells);

    setData(prev => {
      if (!prev) return prev;
      const updateContact = (c: Contact) =>
        c.rowIndex !== editingRowIndex ? c : {
          ...c,
          list: editValues.list,
          function: editValues.function,
          message: editValues.message,
          reply: editValues.reply,
          followUpMessage1: editValues.followUpMessage1,
          followUpMessage2: editValues.followUpMessage2,
          lastContacted: editValues.lastContacted,
          comment: editValues.comment,
        };
      return {
        ...prev,
        allContacts: prev.allContacts.map(updateContact),
        followUps: prev.followUps.map(updateContact),
        newContacts: prev.newContacts.map(updateContact),
      };
    });

    setEditingRowIndex(null);
    setSaveLoading(false);
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
          <button className={`${styles.tab} ${tab === 'followup' ? styles.tabActive : ''}`} onClick={() => handleTabSwitch('followup')}>
            Follow-ups
            <span className={styles.tabCount}>{data ? data.followUps.filter(c => !dismissed.has(c.rowIndex)).length : 0}</span>
          </button>
          <button className={`${styles.tab} ${tab === 'new' ? styles.tabActive : ''}`} onClick={() => handleTabSwitch('new')}>
            New
            <span className={styles.tabCount}>{data ? sortedNewContacts.filter(c => !dismissed.has(c.rowIndex)).length : 0}</span>
          </button>
          <button className={`${styles.tab} ${tab === 'messages' ? styles.tabActive : ''}`} onClick={() => handleTabSwitch('messages')}>
            Messages
          </button>
          <button className={`${styles.tab} ${tab === 'connections' ? styles.tabActive : ''}`} onClick={() => handleTabSwitch('connections')}>
            All
            <span className={styles.tabCount}>{data ? data.allContacts.length : 0}</span>
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className={styles.main}>

        {/* ── ALL CONTACTS TAB ── */}
        {tab === 'connections' ? (() => {
          const allContacts = data?.allContacts ?? [];
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

          const msgAbbrs = data?.messages.map(m => m.abbreviation) ?? [];

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
                    <div className={styles.connectionRow} onClick={() => isEditing ? setEditingRowIndex(null) : openEdit(c)}>
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
                              onChange={e => setEditValues(v => ({ ...v, [key]: e.target.value }))}
                            />
                          </div>
                        ))}
                        <div className={styles.editField}>
                          <label className={styles.editLabel}>Reply</label>
                          <select className={styles.editInput} value={editValues.reply ?? ''} onChange={e => setEditValues(v => ({ ...v, reply: e.target.value }))}>
                            {REPLY_OPTIONS.map(r => <option key={r} value={r}>{r || '—'}</option>)}
                          </select>
                        </div>
                        <div className={styles.editField}>
                          <label className={styles.editLabel}>Message</label>
                          <select className={styles.editInput} value={editValues.message ?? ''} onChange={e => setEditValues(v => ({ ...v, message: e.target.value }))}>
                            <option value="">—</option>
                            {msgAbbrs.map(a => <option key={a} value={a}>{a}</option>)}
                          </select>
                        </div>
                        <div className={styles.editField}>
                          <label className={styles.editLabel}>Follow Up 1</label>
                          <select className={styles.editInput} value={editValues.followUpMessage1 ?? ''} onChange={e => setEditValues(v => ({ ...v, followUpMessage1: e.target.value }))}>
                            <option value="">—</option>
                            {msgAbbrs.map(a => <option key={a} value={a}>{a}</option>)}
                          </select>
                        </div>
                        <div className={styles.editField}>
                          <label className={styles.editLabel}>Follow Up 2</label>
                          <select className={styles.editInput} value={editValues.followUpMessage2 ?? ''} onChange={e => setEditValues(v => ({ ...v, followUpMessage2: e.target.value }))}>
                            <option value="">—</option>
                            {msgAbbrs.map(a => <option key={a} value={a}>{a}</option>)}
                          </select>
                        </div>
                        <div className={styles.editActions}>
                          <button className={styles.editCancelBtn} onClick={() => setEditingRowIndex(null)}>Cancel</button>
                          <button className={styles.editSaveBtn} onClick={saveEdit} disabled={saveLoading}>
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
        })()

        /* ── MESSAGES TAB ── */
        : tab === 'messages' ? (() => {
          const stats: MessageStats[] = data ? getMessageStats(data.allContacts, data.messages) : [];
          const statsMap = Object.fromEntries(stats.map(s => [s.abbreviation, s]));
          const messages = data?.messages ?? [];

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
                              {s?.replyRate !== null && s?.replyRate !== undefined
                                ? `${s.replyRate}%`
                                : s?.sent ? `0%` : '—'}
                            </span>
                            <span className={styles.msgTableAbbr}>{msg.abbreviation}</span>
                            {s?.sent > 0 && (
                              <span className={styles.msgTableSent}>{s.replied}/{s.sent}</span>
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
        })()

        /* ── FOLLOW-UPS / NEW CONTACTS TABS ── */
        : queue.length === 0 ? (
          <>
            {tab === 'new' && (
              <div className={styles.queueControls}>
                <select className={styles.sortSelect} value={newSort} onChange={e => { setNewSort(e.target.value as NewSort); setIndex(0); }}>
                  <option value="recent">Recently connected</option>
                  <option value="oldest">Oldest connected</option>
                  <option value="az">A – Z</option>
                </select>
                {data && (() => {
                  const newLists = Array.from(new Set(data.newContacts.map(c => c.list).filter(Boolean))).sort();
                  const newFunctions = Array.from(new Set(data.newContacts.map(c => c.function).filter(Boolean))).sort();
                  return (
                    <>
                      <select className={styles.filterSelect} value={newFilterList} onChange={e => { setNewFilterList(e.target.value); setIndex(0); }}>
                        <option value="">All lists</option>
                        {newLists.map(l => <option key={l} value={l}>{l}</option>)}
                      </select>
                      <select className={styles.filterSelect} value={newFilterFunction} onChange={e => { setNewFilterFunction(e.target.value); setIndex(0); }}>
                        <option value="">All functions</option>
                        {newFunctions.map(f => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </>
                  );
                })()}
              </div>
            )}
            <div className={styles.emptyState}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                <polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
              <p>Queue is clear</p>
            </div>
          </>
        ) : (
          <>
            {/* Sort/filter bar for New Contacts */}
            {tab === 'new' && (
              <div className={styles.queueControls}>
                <select className={styles.sortSelect} value={newSort} onChange={e => { setNewSort(e.target.value as NewSort); setIndex(0); }}>
                  <option value="recent">Recently connected</option>
                  <option value="oldest">Oldest connected</option>
                  <option value="az">A – Z</option>
                </select>
                {data && (() => {
                  const newLists = Array.from(new Set(data.newContacts.map(c => c.list).filter(Boolean))).sort();
                  const newFunctions = Array.from(new Set(data.newContacts.map(c => c.function).filter(Boolean))).sort();
                  return (
                    <>
                      <select className={styles.filterSelect} value={newFilterList} onChange={e => { setNewFilterList(e.target.value); setIndex(0); }}>
                        <option value="">All lists</option>
                        {newLists.map(l => <option key={l} value={l}>{l}</option>)}
                      </select>
                      <select className={styles.filterSelect} value={newFilterFunction} onChange={e => { setNewFilterFunction(e.target.value); setIndex(0); }}>
                        <option value="">All functions</option>
                        {newFunctions.map(f => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </>
                  );
                })()}
              </div>
            )}

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
                {contact!.list && (
                  <div className={styles.detailRow}>
                    <span className={styles.detailLabel}>List</span>
                    <span className={styles.detailValue}>{contact!.list}</span>
                  </div>
                )}
                {tab === 'new' && contact!.connectedOn && (
                  <div className={styles.detailRow}>
                    <span className={styles.detailLabel}>Connected</span>
                    <span className={styles.detailValue}>{contact!.connectedOn}</span>
                  </div>
                )}
                {tab === 'followup' && (
                  <div className={styles.detailRow}>
                    <span className={styles.detailLabel}>Last contacted</span>
                    <span className={styles.detailValue}>
                      {contact!.lastContacted || 'Never'}
                      {overdueBy !== null && overdueBy > 0 && (
                        <span className={styles.overdueBadge}>+{overdueBy}d overdue</span>
                      )}
                    </span>
                  </div>
                )}
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
                    <><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Copied</>
                  ) : (
                    <><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy message</>
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
              <button className={styles.navBtn} onClick={() => setIndex(i => Math.max(0, i - 1))} disabled={safeIndex === 0}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                Prev
              </button>
              <span className={styles.navCount}>{safeIndex + 1} / {queue.length}</span>
              <button className={styles.navBtn} onClick={() => setIndex(i => Math.min(queue.length - 1, i + 1))} disabled={safeIndex >= queue.length - 1}>
                Next
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </div>

            {/* Message picker */}
            {messageOptions.length > 0 && (
              <div className={styles.msgPickerRow}>
                <label className={styles.msgPickerLabel}>
                  {isSecondFollowUp ? 'Follow up 2' : 'Message sent'}
                </label>
                <select
                  className={styles.msgPickerSelect}
                  value={selectedMessage}
                  onChange={e => setSelectedMessage(e.target.value)}
                >
                  <option value="">— select —</option>
                  {messageOptions.map(m => (
                    <option key={m.abbreviation} value={m.abbreviation}>{m.abbreviation}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Actions */}
            <div className={styles.actionRow}>
              <button
                className={`${styles.actionBtn} ${styles.contactedBtn}`}
                onClick={() => handleAction('contacted')}
                disabled={actionLoading}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                Contacted
              </button>
              <button
                className={`${styles.actionBtn} ${styles.deadBtn}`}
                onClick={() => handleAction('dead')}
                disabled={actionLoading}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                Dead lead
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
