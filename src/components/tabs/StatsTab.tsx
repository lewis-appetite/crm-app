'use client';

import { Stats } from '@/lib/sheets';
import styles from '../OutreachApp.module.css';

function delta(a: number, b: number) {
  const d = a - b;
  if (d === 0) return null;
  return { value: Math.abs(d), positive: d > 0 };
}

function RateRow({ label, stage }: { label: string; stage: { sent: number; replied: number; rate: number | null } }) {
  const pct = stage.rate ?? 0;
  return (
    <div className={styles.rateRow}>
      <span className={styles.rateLabel}>{label}</span>
      <div className={styles.rateBarWrap}>
        <div className={styles.rateBarFill} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className={styles.ratePct}>
        {stage.rate !== null ? `${stage.rate}%` : '—'}
      </span>
      <span className={styles.rateSent}>{stage.replied}/{stage.sent}</span>
    </div>
  );
}

export default function StatsTab({ stats }: { stats: Stats }) {
  const { todayCount, todayNew: tNew, todayFollowUps: tFu, streak, thisWeek, lastWeek, sixWeeks, replyRates } = stats;
  const maxBar = Math.max(...sixWeeks.map(w => w.total), 1);

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
        <RateRow label="Initial message" stage={replyRates.initialMessage} />
        <RateRow label="1st follow-up" stage={replyRates.firstFollowUp} />
        <RateRow label="2nd follow-up" stage={replyRates.secondFollowUp} />
      </div>

    </div>
  );
}
