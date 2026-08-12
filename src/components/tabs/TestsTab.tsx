'use client';

import { useState } from 'react';
import { Message, Experiment, ExperimentResults, ExperimentStage, EXPERIMENT_STAGE_LABELS, isExperimentActive } from '@/lib/sheets';
import styles from '../OutreachApp.module.css';

const MIN_SAMPLE_PER_VARIANT = 20;

const STAGE_MESSAGE_TYPE: Record<ExperimentStage, string> = {
  new: 'Initial Outreach',
  followup1: 'Follow Up',
  followup2: 'Follow Up',
};

interface Props {
  experiments: Experiment[];
  results: ExperimentResults[];
  messages: Message[];
  onCreate: (params: { name: string; stage: ExperimentStage; variantA: string; variantB: string }) => void;
  onEnd: (testId: string, winner: string) => void;
}

function VariantRow({ label, stats }: { label: string; stats: ExperimentResults['a'] }) {
  return (
    <div className={styles.testVariantRow}>
      <span className={styles.testVariantLabel}>{label}</span>
      <span className={styles.testVariantTemplate}>{stats.template || '—'}</span>
      <span className={styles.testVariantStat}>
        {stats.rate !== null
          ? `${stats.rate}% (${stats.replied}/${stats.sent})`
          : `${stats.sent}/${MIN_SAMPLE_PER_VARIANT} sent — too early to call`}
      </span>
    </div>
  );
}

export default function TestsTab({ experiments, results, messages, onCreate, onEnd }: Props) {
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [stage, setStage] = useState<ExperimentStage>('new');
  const [variantA, setVariantA] = useState('');
  const [variantB, setVariantB] = useState('');
  const [endingTestId, setEndingTestId] = useState<string | null>(null);

  const resultsByTestId = Object.fromEntries(results.map(r => [r.testId, r]));
  const active = experiments.filter(isExperimentActive);
  const completed = experiments.filter(e => !isExperimentActive(e));

  const activeStages = new Set(active.map(e => e.stage));
  const templateOptions = messages.filter(m => m.messageType === STAGE_MESSAGE_TYPE[stage]);

  function submit() {
    if (!name.trim() || !variantA || !variantB || variantA === variantB) return;
    onCreate({ name: name.trim(), stage, variantA, variantB });
    setName('');
    setVariantA('');
    setVariantB('');
    setFormOpen(false);
  }

  return (
    <div className={styles.testsPage}>
      <button className={styles.manageBtn} onClick={() => setFormOpen(o => !o)}>
        {formOpen ? 'Close' : '+ New test'}
      </button>

      {formOpen && (
        <div className={styles.managePanel}>
          <div className={styles.editField}>
            <label className={styles.editLabel}>Name</label>
            <input className={styles.editInput} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Dream clients vs 3x meetings" />
          </div>
          <div className={styles.editField}>
            <label className={styles.editLabel}>Stage</label>
            <select
              className={styles.editInput}
              value={stage}
              onChange={e => { setStage(e.target.value as ExperimentStage); setVariantA(''); setVariantB(''); }}
            >
              {(Object.keys(EXPERIMENT_STAGE_LABELS) as ExperimentStage[]).map(s => (
                <option key={s} value={s} disabled={activeStages.has(s)}>
                  {EXPERIMENT_STAGE_LABELS[s]}{activeStages.has(s) ? ' (test already active)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.editField}>
            <label className={styles.editLabel}>Variant A</label>
            <select className={styles.editInput} value={variantA} onChange={e => setVariantA(e.target.value)}>
              <option value="">— select —</option>
              {templateOptions.map(m => <option key={m.abbreviation} value={m.abbreviation}>{m.abbreviation}</option>)}
            </select>
          </div>
          <div className={styles.editField}>
            <label className={styles.editLabel}>Variant B</label>
            <select className={styles.editInput} value={variantB} onChange={e => setVariantB(e.target.value)}>
              <option value="">— select —</option>
              {templateOptions.filter(m => m.abbreviation !== variantA).map(m => <option key={m.abbreviation} value={m.abbreviation}>{m.abbreviation}</option>)}
            </select>
          </div>
          <div className={styles.editActions}>
            <button
              className={styles.editSaveBtn}
              onClick={submit}
              disabled={!name.trim() || !variantA || !variantB || activeStages.has(stage)}
            >
              Start test
            </button>
          </div>
        </div>
      )}

      <div className={styles.testsSectionLabel}>Active</div>
      {active.length === 0 && <span className={styles.manageEmpty}>No active tests</span>}
      {active.map(e => {
        const r = resultsByTestId[e.testId];
        const isEnding = endingTestId === e.testId;
        return (
          <div key={e.testId} className={styles.testCard}>
            <div className={styles.testCardTop}>
              <span className={styles.testCardName}>{e.name}</span>
              <span className={styles.testCardStage}>{EXPERIMENT_STAGE_LABELS[e.stage]}</span>
            </div>
            {r && <VariantRow label="A" stats={r.a} />}
            {r && <VariantRow label="B" stats={r.b} />}
            <div className={styles.testCardMeta}>Started {e.started}</div>
            {isEnding ? (
              <div className={styles.todayMenuRow}>
                <button className={`${styles.todayMenuBtn} ${styles.todayMenuGreen}`} onClick={() => { onEnd(e.testId, 'A'); setEndingTestId(null); }}>A won</button>
                <button className={`${styles.todayMenuBtn} ${styles.todayMenuGreen}`} onClick={() => { onEnd(e.testId, 'B'); setEndingTestId(null); }}>B won</button>
                <button className={styles.todayMenuBtn} onClick={() => { onEnd(e.testId, 'No clear winner'); setEndingTestId(null); }}>No clear winner</button>
                <button className={styles.todayMenuBtn} onClick={() => setEndingTestId(null)}>Cancel</button>
              </div>
            ) : (
              <button className={styles.manageBtn} onClick={() => setEndingTestId(e.testId)}>End test</button>
            )}
          </div>
        );
      })}

      <div className={styles.testsSectionLabel}>Completed</div>
      {completed.length === 0 && <span className={styles.manageEmpty}>No completed tests yet</span>}
      {completed.map(e => {
        const r = resultsByTestId[e.testId];
        return (
          <div key={e.testId} className={styles.testCard}>
            <div className={styles.testCardTop}>
              <span className={styles.testCardName}>{e.name}</span>
              <span className={styles.testCardStage}>{EXPERIMENT_STAGE_LABELS[e.stage]}</span>
            </div>
            {r && <VariantRow label="A" stats={r.a} />}
            {r && <VariantRow label="B" stats={r.b} />}
            <div className={styles.testCardMeta}>
              {e.started} – {e.ended || '—'} · Winner: {e.winner || '—'}
            </div>
          </div>
        );
      })}
    </div>
  );
}
