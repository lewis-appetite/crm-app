'use client';

import { Contact, CampaignEntry, CompanyGroup, Tier, CAMPAIGN_STAGES, daysAgo, normAbbr } from '@/lib/sheets';
import styles from '../OutreachApp.module.css';

const TIER_LABELS: Record<Tier, string> = {
  1: 'Cake campaign',
  2: 'Interested reply',
};
const TIER_ICONS: Record<Tier, string> = { 1: '\u{1F382}', 2: '\u{1F525}' };
const TIER_STYLE: Record<Tier, string> = { 1: 'tierCake', 2: 'tierWarm' };

interface Props {
  groups: CompanyGroup[];
  suggestions: string[];
  allContacts: Contact[];
  focusedCompanies: CampaignEntry[];
  tierFilter: Tier | null;
  onTierFilterChange: (updater: (f: Tier | null) => Tier | null) => void;
  manageOpen: boolean;
  onToggleManage: () => void;
  newCompanyName: string;
  onNewCompanyNameChange: (v: string) => void;
  onAddToFocus: (company?: string) => void;
  onRemoveFromFocus: (company: string) => void;
  onSetStage: (company: string, status: string) => void;
  companyNotesDrafts: Record<string, string>;
  onNotesDraftChange: (company: string, value: string) => void;
  onSaveNotes: (company: string, notes: string) => void;
  expandedCompanies: Set<string>;
  onToggleExpanded: (company: string) => void;
  activeMenu: { rowIndex: number; type: 'snooze' | 'replied' } | null;
  onSetActiveMenu: (menu: { rowIndex: number; type: 'snooze' | 'replied' } | null) => void;
  onSnooze: (c: Contact, days: number) => void;
  onReplied: (c: Contact, value: 'Interested' | 'Not interested') => void;
  onMeetingBooked: (c: Contact) => void;
  onDone: (c: Contact) => void;
  commentDrafts: Record<number, string>;
  onCommentDraftChange: (rowIndex: number, value: string) => void;
  onSaveComment: (c: Contact) => void;
  onLinkedIn: (c: Contact) => void;
  onDraftEmail: (c: Contact) => void;
  onFindEmail: (c: Contact) => void;
  onCallContact: (c: Contact) => void;
  emailBusy: Record<number, 'enriching' | 'drafting'>;
}

export default function FocusTab({
  groups, suggestions, allContacts, focusedCompanies,
  tierFilter, onTierFilterChange, manageOpen, onToggleManage,
  newCompanyName, onNewCompanyNameChange, onAddToFocus, onRemoveFromFocus, onSetStage,
  companyNotesDrafts, onNotesDraftChange, onSaveNotes,
  expandedCompanies, onToggleExpanded, activeMenu, onSetActiveMenu,
  onSnooze, onReplied, onMeetingBooked, onDone,
  commentDrafts, onCommentDraftChange, onSaveComment,
  onLinkedIn, onDraftEmail, onFindEmail, onCallContact, emailBusy,
}: Props) {
  const tierCounts: Record<Tier, number> = { 1: 0, 2: 0 };
  groups.forEach(g => g.contacts.forEach(c => { tierCounts[c.tier]++; }));
  const visibleGroups = tierFilter ? groups.filter(g => g.contacts.some(c => c.tier === tierFilter)) : groups;

  const focusedKeys = new Set(focusedCompanies.map(c => normAbbr(c.company)));
  const allCompanyNames = Array.from(new Set(allContacts.map(c => c.company).filter(Boolean))).sort();
  const companySuggestions = newCompanyName.trim()
    ? allCompanyNames
        .filter(name => normAbbr(name).includes(normAbbr(newCompanyName)) && !focusedKeys.has(normAbbr(name)))
        .slice(0, 8)
    : [];

  return (
    <div className={styles.todayPage}>
      <div className={styles.tierChipsRow}>
        {([1, 2] as Tier[]).map(t => (
          <button
            key={t}
            className={`${styles.tierChip} ${styles[TIER_STYLE[t]]} ${tierFilter === t ? styles.tierChipActive : ''}`}
            onClick={() => onTierFilterChange(f => (f === t ? null : t))}
          >
            {TIER_ICONS[t]} {tierCounts[t]}
          </button>
        ))}
        <button className={styles.manageBtn} onClick={onToggleManage}>
          {manageOpen ? 'Close' : 'Manage shortlist'}
        </button>
      </div>

      {manageOpen && (
        <div className={styles.managePanel}>
          <div className={styles.manageAddWrap}>
            <div className={styles.manageAddRow}>
              <input
                className={styles.manageInput}
                placeholder="Company name"
                value={newCompanyName}
                onChange={e => onNewCompanyNameChange(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && onAddToFocus()}
              />
              <button className={styles.manageAddBtn} onClick={() => onAddToFocus()}>Add</button>
            </div>
            {companySuggestions.length > 0 && (
              <div className={styles.manageSuggestions}>
                {companySuggestions.map(name => (
                  <button key={name} className={styles.manageSuggestion} onClick={() => onAddToFocus(name)}>
                    {name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {suggestions.length > 0 && (
            <div className={styles.manageAutoSuggest}>
              <div className={styles.manageAutoSuggestLabel}>Suggested (active cake campaign or Interested reply)</div>
              <div className={styles.manageSuggestions}>
                {suggestions.map(name => (
                  <button key={name} className={styles.manageSuggestion} onClick={() => onAddToFocus(name)}>
                    + {name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className={styles.manageList}>
            {focusedCompanies.map(c => {
              const notesValue = companyNotesDrafts[c.company] ?? c.notes;
              const dirty = notesValue !== c.notes;
              return (
                <div key={c.company} className={styles.manageRow}>
                  <div className={styles.manageRowTop}>
                    <span className={styles.manageRowName}>{c.company}</span>
                    {c.cakeSentDate && <span className={styles.manageCakeDate}>🎂 {c.cakeSentDate}</span>}
                    <select
                      className={styles.manageStageSelect}
                      value={CAMPAIGN_STAGES.includes(c.status as typeof CAMPAIGN_STAGES[number]) ? c.status : ''}
                      onChange={e => e.target.value && onSetStage(c.company, e.target.value)}
                      aria-label={`Campaign stage for ${c.company}`}
                    >
                      {!CAMPAIGN_STAGES.includes(c.status as typeof CAMPAIGN_STAGES[number]) && (
                        <option value="">{c.status || '— no stage —'}</option>
                      )}
                      {CAMPAIGN_STAGES.map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                    <button className={styles.manageRemoveBtn} onClick={() => onRemoveFromFocus(c.company)} aria-label={`Remove ${c.company} from Focus`} title="Remove from Focus">×</button>
                  </div>
                  <div className={styles.manageNotesRow}>
                    <input
                      className={styles.manageNotesInput}
                      placeholder="Notes on this company…"
                      value={notesValue}
                      onChange={e => onNotesDraftChange(c.company, e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && onSaveNotes(c.company, notesValue)}
                    />
                    {dirty && (
                      <button className={styles.manageNotesSaveBtn} onClick={() => onSaveNotes(c.company, notesValue)}>
                        Save
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {focusedCompanies.length === 0 && <span className={styles.manageEmpty}>No companies shortlisted yet</span>}
          </div>
        </div>
      )}

      {groups.length === 0 ? (
        <div className={styles.emptyState}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
            <polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
          <p>All caught up</p>
        </div>
      ) : visibleGroups.map(g => {
        const isExpanded = expandedCompanies.has(g.company);
        return (
          <div key={g.company} className={styles.companyCard}>
            <div className={styles.companyHeader} onClick={() => onToggleExpanded(g.company)}>
              <span className={styles.companyName}>{g.company}</span>
              <span className={`${styles.companyTierBadge} ${styles[TIER_STYLE[g.tier]]}`}>
                {TIER_ICONS[g.tier]} {g.tier === 1 && g.stage ? g.stage : TIER_LABELS[g.tier]}
              </span>
              {g.maxOverdueDays !== null && g.maxOverdueDays > 0 && (
                <span className={styles.overdueBadge}>+{g.maxOverdueDays}d</span>
              )}
              <span className={styles.companyDueCount}>{g.contacts.length} due</span>
              <svg className={`${styles.expandIcon} ${isExpanded ? styles.expandIconOpen : ''}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </div>

            {isExpanded && (
              <div className={styles.companyContacts}>
                {g.contacts.map(c => {
                  const initials = `${c.firstName[0] ?? ''}${c.lastName[0] ?? ''}`.toUpperCase();
                  const menu = activeMenu?.rowIndex === c.rowIndex ? activeMenu.type : null;
                  return (
                    <div key={c.rowIndex} className={styles.todayContact}>
                      <div className={styles.todayContactTop}>
                        <div className={styles.todayAvatar}>{initials}</div>
                        <div className={styles.todayContactMeta}>
                          <div className={styles.todayContactNameRow}>
                            <span className={styles.todayContactName}>{c.fullName}</span>
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
                            {c.position}{c.position && (c.lastContacted || c.reply) ? ' · ' : ''}
                            {c.lastContacted ? `${daysAgo(c.lastContacted)}d ago` : c.reply || 'never contacted'}
                          </span>
                        </div>
                        {c.overdueDays !== null && c.overdueDays > 0 && (
                          <span className={styles.todayOverdue}>+{c.overdueDays}d</span>
                        )}
                      </div>

                      {c.followUpDue && (
                        <div className={styles.followUpDueBadge}>Follow-up also due</div>
                      )}

                      {(parseInt(c.followUps) || 0) >= 2 && !c.reply && (
                        <div className={styles.emailNudge}>
                          {'\u{1F4E7}'} {parseInt(c.followUps)} follow-ups, no reply — time to try email
                        </div>
                      )}

                      {menu === 'snooze' ? (
                        <div className={styles.todayMenuRow}>
                          <button className={styles.todayMenuBtn} onClick={() => onSnooze(c, 1)}>1 day</button>
                          <button className={styles.todayMenuBtn} onClick={() => onSnooze(c, 3)}>3 days</button>
                          <button className={styles.todayMenuBtn} onClick={() => onSnooze(c, 7)}>1 week</button>
                          <button className={styles.todayMenuBtn} onClick={() => onSetActiveMenu(null)}>Cancel</button>
                        </div>
                      ) : menu === 'replied' ? (
                        <div className={styles.todayMenuRow}>
                          <button className={`${styles.todayMenuBtn} ${styles.todayMenuGreen}`} onClick={() => onReplied(c, 'Interested')}>Interested</button>
                          <button className={`${styles.todayMenuBtn} ${styles.todayMenuGreen}`} onClick={() => onMeetingBooked(c)}>Meeting booked</button>
                          <button className={`${styles.todayMenuBtn} ${styles.todayMenuRed}`} onClick={() => onReplied(c, 'Not interested')}>Not interested</button>
                          <button className={styles.todayMenuBtn} onClick={() => onSetActiveMenu(null)}>Cancel</button>
                        </div>
                      ) : (
                        <div className={styles.todayActionsRow}>
                          <button className={`${styles.todayActionBtn} ${styles.todayActionGreen}`} onClick={() => onDone(c)}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                            Done
                          </button>
                          <button className={styles.todayActionBtn} onClick={() => onSetActiveMenu({ rowIndex: c.rowIndex, type: 'snooze' })}>Snooze</button>
                          <button className={styles.todayActionBtn} onClick={() => onSetActiveMenu({ rowIndex: c.rowIndex, type: 'replied' })}>Replied</button>
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
                      )}

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
            )}
          </div>
        );
      })}
    </div>
  );
}
