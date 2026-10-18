'use client';

import { useRef, useState } from 'react';
import { ActivityEvent, Contact, Message, ReplyStage, attributeSends, getMessageStats, MessageStats } from '@/lib/sheets';
import styles from '../OutreachApp.module.css';

type MessagesView = 'cards' | 'table';

const stageLabel = (stage: ReplyStage) => (stage === 'new' ? 'Initial' : `FU${stage.slice('followup'.length)}`);
const stageNum = (stage: ReplyStage) => (stage === 'new' ? 0 : parseInt(stage.slice('followup'.length), 10));

export default function MessagesTab({ allContacts, messages, activity }: { allContacts: Contact[]; messages: Message[]; activity: ActivityEvent[] }) {
  const [messagesView, setMessagesView] = useState<MessagesView>('cards');
  const [stageFilter, setStageFilter] = useState<'all' | ReplyStage>('all');
  const [copiedMsg, setCopiedMsg] = useState<string | null>(null);
  const msgCopyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleCopyMessage(text: string, abbr: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedMsg(abbr);
      if (msgCopyTimeout.current) clearTimeout(msgCopyTimeout.current);
      msgCopyTimeout.current = setTimeout(() => setCopiedMsg(null), 2000);
    });
  }

  const { unattributedReplies } = attributeSends(allContacts, activity);
  const allStats: MessageStats[] = getMessageStats(allContacts, messages, activity);
  const stageOptions = Array.from(new Set(allStats.flatMap(s => s.byStage.map(b => b.stage)))).sort((a, b) => stageNum(a) - stageNum(b));

  // 'all' blends every stage a template was used at; picking a stage shows each
  // template's numbers at that stage only, and hides templates never sent there
  const statsMap: Record<string, { sent: number; replied: number; replyRate: number | null } | undefined> =
    Object.fromEntries(allStats.map(s => [s.abbreviation, stageFilter === 'all' ? s : s.byStage.find(b => b.stage === stageFilter)]));
  const byStageMap = Object.fromEntries(allStats.map(s => [s.abbreviation, s.byStage]));
  const visibleMessages = stageFilter === 'all' ? messages : messages.filter(m => (statsMap[m.abbreviation]?.sent ?? 0) > 0);

  const GROUP_ORDER = ['initial outreach', 'follow up'];
  const groupRank = (type: string) => {
    const i = GROUP_ORDER.indexOf(type.trim().toLowerCase());
    return i === -1 ? GROUP_ORDER.length : i;
  };

  // Initial Outreach first, then Follow Up (anything else after), reply rate desc within each group
  const groups = Array.from(new Set(messages.map(m => m.messageType)))
    .sort((a, b) => groupRank(a) - groupRank(b))
    .map(type => ({
      type,
      messages: visibleMessages
        .filter(m => m.messageType === type)
        .sort((a, b) => {
          const ra = statsMap[a.abbreviation]?.replyRate ?? -1;
          const rb = statsMap[b.abbreviation]?.replyRate ?? -1;
          return rb - ra;
        }),
    }));
  const sortedMessages = groups.flatMap(g => g.messages);

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

      {/* Stage selector */}
      <div className={styles.viewToggle}>
        {(['all', ...stageOptions] as ('all' | ReplyStage)[]).map(st => (
          <button
            key={st}
            className={`${styles.viewToggleBtn} ${stageFilter === st ? styles.viewToggleActive : ''}`}
            onClick={() => setStageFilter(st)}
          >{st === 'all' ? 'All stages' : stageLabel(st)}</button>
        ))}
      </div>

      {unattributedReplies > 0 && (
        <div className={styles.messageSentRow}>
          {unattributedReplies} {unattributedReplies === 1 ? 'reply has' : 'replies have'} no logged date and {unattributedReplies === 1 ? 'is' : 'are'} credited to the initial message
        </div>
      )}

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
                    {s && s.sent > 0 && (
                      <span className={styles.msgTableSent}>{s.replied}/{s.sent} sent</span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ) : (
        sortedMessages.map((msg, i) => {
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
              {stageFilter === 'all' && (byStageMap[msg.abbreviation]?.length ?? 0) > 1 && (
                <div className={styles.messageSentRow}>
                  {byStageMap[msg.abbreviation].map(b => `${stageLabel(b.stage)} ${b.replyRate !== null ? `${b.replyRate}%` : '—'} (${b.replied}/${b.sent})`).join(' · ')}
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
