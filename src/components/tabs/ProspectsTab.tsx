'use client';

import { useState } from 'react';
import { ProspectCompany, PROSPECT_REJECTION_REASONS, PROSPECT_CHANNELS, ProspectChannel, prospectChannels } from '@/lib/sheets';
import styles from '../OutreachApp.module.css';

interface Props {
  prospects: ProspectCompany[];
  onApprove: (company: string, channel: ProspectChannel) => void;
  onReject: (company: string, reason: string) => void;
  onSaveAddress: (company: string, address: string, confirmedBy: string) => void;
  onCakeSent: (company: string) => void;
}

function Firmographics({ p }: { p: ProspectCompany }) {
  const bits = [p.industry, p.companySize, p.fundingStage, p.location].filter(Boolean);
  return (
    <div className={styles.prospectMeta}>
      {(p.websiteUrl || p.companyLinkedinUrl) && (
        <div className={styles.prospectLinks}>
          {p.websiteUrl && (
            <a href={p.websiteUrl} target="_blank" rel="noopener noreferrer" className={styles.prospectWebsite}>
              {p.websiteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}
            </a>
          )}
          {p.companyLinkedinUrl && (
            <a href={p.companyLinkedinUrl} target="_blank" rel="noopener noreferrer" className={styles.prospectWebsite}>
              LinkedIn
            </a>
          )}
        </div>
      )}
      {bits.length > 0 && <span>{bits.join(' · ')}</span>}
    </div>
  );
}

const FIT_RATING_STYLE: Record<string, string> = {
  high: 'prospectFitHigh',
  medium: 'prospectFitMedium',
  med: 'prospectFitMedium',
  low: 'prospectFitLow',
};

function ResearchDetail({ p }: { p: ProspectCompany }) {
  if (!p.fitRating && !p.reasoning && !p.outboundEvidence && !p.recentNews) return null;
  const fitClass = FIT_RATING_STYLE[p.fitRating.trim().toLowerCase()];
  return (
    <div className={styles.prospectResearch}>
      {p.fitRating && (
        <span className={`${styles.prospectFitBadge} ${fitClass ? styles[fitClass] : ''}`}>{p.fitRating} fit</span>
      )}
      {p.reasoning && <p className={styles.prospectReasoning}>{p.reasoning}</p>}
      {p.outboundEvidence && (
        <div className={styles.prospectResearchRow}><strong>Outbound evidence:</strong> {p.outboundEvidence}</div>
      )}
      {p.recentNews && (
        <div className={styles.prospectResearchRow}><strong>Recent news:</strong> {p.recentNews}</div>
      )}
    </div>
  );
}

function ContactList({ p }: { p: ProspectCompany }) {
  return (
    <div className={styles.prospectContacts}>
      {p.contacts.map(c => (
        <div key={c.rowIndex} className={styles.prospectContact}>
          {c.url ? (
            <a className={styles.prospectContactName} href={c.url} target="_blank" rel="noopener noreferrer">
              {c.contactName || '—'}
            </a>
          ) : (
            <span className={styles.prospectContactName}>{c.contactName || '—'}</span>
          )}
          {c.position && <span className={styles.prospectContactRole}>{c.position}</span>}
        </div>
      ))}
    </div>
  );
}

export default function ProspectsTab({ prospects, onApprove, onReject, onSaveAddress, onCakeSent }: Props) {
  const [rejectingCompany, setRejectingCompany] = useState<string | null>(null);
  const [approvingCompany, setApprovingCompany] = useState<string | null>(null);
  const [addressDrafts, setAddressDrafts] = useState<Record<string, { address: string; confirmedBy: string }>>({});

  const pending = prospects.filter(p => p.status === 'Pending');
  const working = prospects.filter(p => p.status === 'Approved' || p.status === 'Ready to send');
  const rejected = prospects.filter(p => p.status === 'Rejected');
  const cakeWorking = working.filter(p => prospectChannels(p.channel).includes('Cake'));
  const digitalWorking = working.filter(p => prospectChannels(p.channel).includes('Digital'));

  function draftFor(p: ProspectCompany) {
    return addressDrafts[p.company] ?? { address: p.address, confirmedBy: p.addressConfirmedBy };
  }

  function setDraft(company: string, patch: Partial<{ address: string; confirmedBy: string }>) {
    setAddressDrafts(prev => ({
      ...prev,
      [company]: { ...(prev[company] ?? { address: '', confirmedBy: '' }), ...patch },
    }));
  }

  return (
    <div className={styles.testsPage}>

      <div className={styles.testsSectionLabel}>To review · {pending.length}</div>
      {pending.length === 0 && <span className={styles.manageEmpty}>Nothing waiting for review</span>}
      {pending.map(p => (
        <div key={p.company} className={styles.testCard}>
          <div className={styles.testCardTop}>
            <span className={styles.testCardName}>{p.company}</span>
            {p.inCampaigns && <span className={styles.prospectFlag}>in Campaigns</span>}
            {!p.inCampaigns && p.inConnections && <span className={styles.prospectFlag}>in CRM</span>}
          </div>
          <Firmographics p={p} />
          <ResearchDetail p={p} />
          <ContactList p={p} />
          {p.knownContactCount > 0 && (
            <div className={styles.prospectNote}>
              {p.knownContactCount} of these {p.knownContactCount === 1 ? 'is' : 'are'} already a connection
            </div>
          )}

          {rejectingCompany === p.company ? (
            <div className={styles.prospectReasonRow}>
              {PROSPECT_REJECTION_REASONS.map(reason => (
                <button
                  key={reason}
                  className={styles.todayMenuBtn}
                  onClick={() => { onReject(p.company, reason); setRejectingCompany(null); }}
                >
                  {reason}
                </button>
              ))}
              <button className={styles.todayMenuBtn} onClick={() => setRejectingCompany(null)}>Cancel</button>
            </div>
          ) : approvingCompany === p.company ? (
            <div className={styles.prospectReasonRow}>
              <button
                className={styles.todayMenuBtn}
                onClick={() => { onApprove(p.company, 'Cake'); setApprovingCompany(null); }}
              >
                🎂 Cake (+ digital)
              </button>
              <button
                className={styles.todayMenuBtn}
                onClick={() => { onApprove(p.company, 'Digital'); setApprovingCompany(null); }}
              >
                Digital only
              </button>
              <button className={styles.todayMenuBtn} onClick={() => setApprovingCompany(null)}>Cancel</button>
            </div>
          ) : (
            <div className={styles.todayActionsRow}>
              <button className={`${styles.todayActionBtn} ${styles.todayActionGreen}`} onClick={() => setApprovingCompany(p.company)}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                Approve
              </button>
              <button className={styles.todayActionBtn} onClick={() => setRejectingCompany(p.company)}>Reject</button>
            </div>
          )}
        </div>
      ))}

      <div className={styles.testsSectionLabel}>🎂 Cake outreach · {cakeWorking.length}</div>
      {cakeWorking.length === 0 && <span className={styles.manageEmpty}>No cake-track prospects in flight</span>}
      {cakeWorking.map(p => {
        const draft = draftFor(p);
        const dirty = draft.address !== p.address || draft.confirmedBy !== p.addressConfirmedBy;
        const readyToSend = !!p.address && !!p.addressConfirmedBy;
        return (
          <div key={p.company} className={styles.testCard}>
            <div className={styles.testCardTop}>
              <span className={styles.testCardName}>{p.company}</span>
              <span className={styles.testCardStage}>{readyToSend ? 'Ready to send' : 'Approved'}</span>
            </div>
            <Firmographics p={p} />
            <ContactList p={p} />

            <div className={styles.editField}>
              <label className={styles.editLabel}>Delivery address</label>
              <input
                className={styles.editInput}
                placeholder="Office address for the cake…"
                value={draft.address}
                onChange={e => setDraft(p.company, { address: e.target.value })}
              />
            </div>
            <div className={styles.editField}>
              <label className={styles.editLabel}>Confirmed by</label>
              <input
                className={styles.editInput}
                placeholder="Which contact validated it?"
                value={draft.confirmedBy}
                onChange={e => setDraft(p.company, { confirmedBy: e.target.value })}
              />
            </div>

            <div className={styles.todayActionsRow}>
              {dirty && (
                <button
                  className={styles.todayActionBtn}
                  onClick={() => onSaveAddress(p.company, draft.address, draft.confirmedBy)}
                >
                  Save address
                </button>
              )}
              <button
                className={`${styles.todayActionBtn} ${styles.todayActionGreen}`}
                onClick={() => onCakeSent(p.company)}
                disabled={!readyToSend}
                title={readyToSend ? 'Moves this company into Campaigns as Delivered' : 'Add and confirm an address first'}
              >
                🎂 Cake sent
              </button>
            </div>
          </div>
        );
      })}

      <div className={styles.testsSectionLabel}>Digital outreach · {digitalWorking.length}</div>
      {digitalWorking.length === 0 && <span className={styles.manageEmpty}>No digital-track prospects in flight</span>}
      {digitalWorking.map(p => (
        <div key={p.company} className={styles.testCard}>
          <div className={styles.testCardTop}>
            <span className={styles.testCardName}>{p.company}</span>
            <span className={styles.testCardStage}>{prospectChannels(p.channel).includes('Cake') ? 'Also on Cake track' : 'Digital only'}</span>
          </div>
          <Firmographics p={p} />
          <ContactList p={p} />
        </div>
      ))}

      {rejected.length > 0 && (
        <>
          <div className={styles.testsSectionLabel}>Rejected · {rejected.length}</div>
          {rejected.map(p => (
            <div key={p.company} className={styles.testCard}>
              <div className={styles.testCardTop}>
                <span className={styles.testCardName}>{p.company}</span>
                <span className={styles.testCardStage}>{p.rejectionReason || 'Rejected'}</span>
              </div>
              <Firmographics p={p} />
            </div>
          ))}
        </>
      )}

    </div>
  );
}
