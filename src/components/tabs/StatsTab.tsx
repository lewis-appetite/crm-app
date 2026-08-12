'use client';

import { useState } from 'react';
import { Stats, Contact, ReplyStage, getReplyBreakdown } from '@/lib/sheets';
import styles from '../OutreachApp.module.css';

function delta(a: number, b: number) {
  const d = a - b;
  if (d === 0) return null;
  return { value: Math.abs(d), positive: d > 0 };
}

const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'];
function ordinal(n: number): string {
  return ORDINALS[n - 1] ?? `${n}th`;
}

function RateRow({
  label, stage, stageKey, expanded, onToggle,
}: {
  label: string;
  stage: { sent: number; replied: number; rate: number | null };
  stageKey: ReplyStage;
  expanded: boolean;
  onToggle: (key: ReplyStage) => void;
}) {
  const pct = stage.rate ?? 0;
  return (
    <button className={styles.rateRow} onClick={() => onToggle(stageKey)}>
      <span className={styles.rateLabel}>{label}</span>
      <div className={styles.rateBarWrap}>
        <div className={styles.rateBarFill} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className={styles.ratePct}>
        {stage.rate !== null ? `${stage.rate}%` : '—'}
      </span>
      <span className={styles.rateSent} title={`${stage.replied} replied / ${stage.sent} sent`}>
        {stage.sent} sent
      </span>
      <svg className={`${styles.expandIcon} ${expanded ? styles.expandIconOpen : ''}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    </button>
  );
}

export default function StatsTab({ stats, allContacts }: { stats: Stats; allContacts: Contact[] }) {
  const { todayCount, todayNew: tNew, todayFollowUps: tFu, streak, thisWeek, lastWeek, sixWeeks, replyRates } = stats;
  const maxBar = Math.max(...sixWeeks.map(w => w.total), 1);
  const [expandedStage, setExpandedStage] = useState<ReplyStage | null>(null);

  const breakdown = getReplyBreakdown(allContacts);
  const breakdownByStage = (stage: ReplyStage) => breakdown.filter(r => r.stage === stage);

  return (
    <div className={styles.statsPage}>

      {/* Today + streak */}
      <div className={styles.statsCard}>
        <div className={styles.statsTodayRow}>
          <div>
            <div className={styles.statsBigNum}>{todayCount}</div>
            <div className={styles.statsBigLabel}>outreach today</div>
            <div className={styles.statsTodaySplit}>{tNew} new · {tFu} follow-ups</div>
          </div>
          {streak > 0 && (
            <div className={styles.streakBadge}>
              <span className={styles.streakFlame}>🔥</span>
              <span className={styles.streakNum}>{streak}</span>
              <span className={styles.streakLabel}>day streak</span>
            </div>
          )}
        </div>
      </div>

      {/* This week vs last week */}
      <div className={styles.statsCard}>
        <div className={styles.statsCardTitle}>This week vs last</div>
        <div className={styles.weekTable}>
          <div className={styles.weekTableHeader}>
            <span />
            <span>This week</span>
            <span>Last week</span>
            <span>Δ</span>
          </div>
          {[
            { label: 'New', a: thisWeek.newOutreach, b: lastWeek.newOutreach },
            { label: 'Follow-ups', a: thisWeek.followUps, b: lastWeek.followUps },
            { label: 'Total', a: thisWeek.total, b: lastWeek.total },
          ].map(({ label, a, b }) => {
            const d = delta(a, b);
            return (
              <div key={label} className={styles.weekTableRow}>
                <span className={styles.weekRowLabel}>{label}</span>
                <span className={styles.weekRowVal}>{a}</span>
                <span className={styles.weekRowVal}>{b}</span>
                <span className={`${styles.weekRowDelta} ${d ? (d.positive ? styles.deltaPos : styles.deltaNeg) : ''}`}>
                  {d ? `${d.positive ? '+' : '-'}${d.value}` : '—'}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 6-week bar chart */}
      <div className={styles.statsCard}>
        <div className={styles.statsCardTitle}>Last 6 weeks</div>
        <svg viewBox={`0 0 ${sixWeeks.length * 52} 100`} className={styles.barChart} preserveAspectRatio="none">
          {sixWeeks.map((w, i) => {
            const x = i * 52 + 4;
            const barW = 44;
            const maxH = 72;
            const totalH = Math.round((w.total / maxBar) * maxH);
            const newH = Math.round((w.newOutreach / maxBar) * maxH);
            const fuH = totalH - newH;
            return (
              <g key={i}>
                {fuH > 0 && <rect x={x} y={maxH - totalH} width={barW} height={fuH} className={styles.barFollowUp} rx="2" />}
                {newH > 0 && <rect x={x} y={maxH - newH} width={barW} height={newH} className={styles.barNew} rx="2" />}
                <text x={x + barW / 2} y="88" textAnchor="middle" className={styles.barLabel}>{w.label}</text>
                {w.total > 0 && <text x={x + barW / 2} y={maxH - totalH - 3} textAnchor="middle" className={styles.barValue}>{w.total}</text>}
              </g>
            );
          })}
        </svg>
        <div className={styles.barLegend}>
          <span className={styles.legendNew}>■ New</span>
          <span className={styles.legendFu}>■ Follow-up</span>
        </div>
      </div>

      {/* Reply rates by stage */}
      <div className={styles.statsCard}>
        <div className={styles.statsCardTitle}>Reply rates by stage</div>
        {([
          ['new', 'Initial message', replyRates.initialMessage],
          ...replyRates.followUps.map(
            (stage, i) => [`followup${i + 1}`, `${ordinal(i + 1)} follow-up`, stage] as const
          ),
        ] as [ReplyStage, string, { sent: number; replied: number; rate: number | null }][]).map(([key, label, stage]) => (
          <div key={key}>
            <RateRow
              label={label}
              stage={stage}
              stageKey={key}
              expanded={expandedStage === key}
              onToggle={k => setExpandedStage(cur => (cur === k ? null : k))}
            />
            {expandedStage === key && (
              <div className={styles.replyBreakdown}>
                {breakdownByStage(key).length === 0 ? (
                  <span className={styles.manageEmpty}>No sends yet at this stage</span>
                ) : (
                  <>
                    <div className={styles.replyBreakdownHeader}>
                      <span>Template</span>
                      <span>Sent</span>
                      <span>Reply %</span>
                      <span>Positive %</span>
                    </div>
                    {breakdownByStage(key).map(row => (
                      <div key={row.template} className={styles.replyBreakdownRow}>
                        <span className={styles.replyBreakdownTemplate}>{row.template}</span>
                        <span className={styles.replyBreakdownStat}>{row.sent}</span>
                        <span className={styles.replyBreakdownStat}>
                          {row.replyRate !== null ? `${row.replyRate}%` : '—'} <span className={styles.rateSent}>({row.replied}/{row.sent})</span>
                        </span>
                        <span className={styles.replyBreakdownStat}>
                          {row.positiveRate !== null ? `${row.positiveRate}%` : '—'} <span className={styles.rateSent}>({row.positive}/{row.sent})</span>
                        </span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

    </div>
  );
}
