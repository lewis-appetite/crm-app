'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Contact, Message, SuggestedMessage, ActivityEvent, CompanyGroup, Tier, CampaignEntry,
  suggestMessage, daysAgo, parseDate, todayDMY, isCampaignActive, computePriorityLabel,
  getMessageStats, normAbbr,
  getStats, Stats, CAMPAIGN_STAGES,
  getRegionMode, regionSortRank,
  Experiment, ExperimentResults, ExperimentStage,
  getActiveExperiment, assignedTemplate, assignVariant,
  ProspectCompany,
  ProspectChannel,
  nextFollowUpStage, followUpFieldKey, FOLLOW_UP_MAX, FollowUpFieldKey, FOLLOW_UP_FIELD_KEYS,
  getRepliedQueue,
} from '@/lib/sheets';
import CakeTab from './tabs/CakeTab';
import StatsTab from './tabs/StatsTab';
import MessagesTab from './tabs/MessagesTab';
import ConnectionsTab from './tabs/ConnectionsTab';
import FocusTab from './tabs/FocusTab';
import TestsTab from './tabs/TestsTab';
import ProspectsTab from './tabs/ProspectsTab';
import RepliedTab from './tabs/RepliedTab';

interface CakeImage {
  name: string;
  fileId: string;
  viewLink: string;
}

function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}
import styles from './OutreachApp.module.css';

interface SheetData {
  followUps: Contact[];
  newContacts: Contact[];
  focus: CompanyGroup[];
  focusSuggestions: string[];
  experiments: Experiment[];
  experimentResults: ExperimentResults[];
  prospects: ProspectCompany[];
  messages: Message[];
  allContacts: Contact[];
  activity: ActivityEvent[];
  campaigns: CampaignEntry[];
  columns: Record<string, string>;
  intervalDays: number;
  dailyNewGoal: number;
}

type Tab = 'followup' | 'new' | 'focus' | 'replied' | 'messages' | 'cake' | 'connections' | 'stats' | 'tests' | 'prospects';
const MORE_TABS: { tab: Tab; label: string }[] = [
  { tab: 'replied', label: 'Replied' },
  { tab: 'prospects', label: 'Cake Prospect' },
  { tab: 'messages', label: 'Messages' },
  { tab: 'cake', label: 'Cake' },
  { tab: 'tests', label: 'Tests' },
  { tab: 'stats', label: 'Stats' },
];

type NewSort = 'recent' | 'oldest' | 'az';

interface UpdateBody {
  rowIndex?: number;
  cells?: { col: string; value: string }[];
  log?: {
    date: string;
    rowIndex: number;
    name: string;
    company: string;
    action: string;
    template: string;
    detail: string;
  };
  campaign?: { company: string; status?: string; notes?: string; focus?: boolean };
  prospect?: {
    company: string;
    status?: string;
    rejectionReason?: string;
    channel?: string;
    address?: string;
    addressConfirmedBy?: string;
    dateReviewed?: string;
  };
  experiment?: {
    testId: string;
    name?: string;
    stage?: string;
    variantA?: string;
    variantB?: string;
    status?: string;
    started?: string;
    ended?: string;
    winner?: string;
    notes?: string;
  };
}

async function postUpdate(payload: UpdateBody): Promise<boolean> {
  try {
    const res = await fetch('/api/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return false;
    const json = await res.json();
    return !!json.ok;
  } catch {
    return false;
  }
}

function GoalRing({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  const r = 14;
  const circ = 2 * Math.PI * r;
  const done = max > 0 && value >= max;
  return (
    <div className={styles.goalRing}>
      <svg width="36" height="36" viewBox="0 0 36 36">
        <circle cx="18" cy="18" r={r} className={styles.ringTrack} />
        <circle
          cx="18" cy="18" r={r}
          className={`${styles.ringFill} ${done ? styles.ringDone : ''}`}
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct)}
          transform="rotate(-90 18 18)"
        />
      </svg>
      <div className={styles.ringText}>
        <span className={styles.ringValue}>
          {value}<span className={styles.ringMax}>/{max}</span>
        </span>
        <span className={styles.ringLabel}>{label}</span>
      </div>
    </div>
  );
}

export default function OutreachApp() {
  const [data, setData] = useState<SheetData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('followup');
  const [index, setIndex] = useState(0);

  const [cakeImages, setCakeImages] = useState<CakeImage[]>([]);

  // Gamification
  const [localEvents, setLocalEvents] = useState<ActivityEvent[]>([]);
  const [combo, setCombo] = useState(0);
  const [sessionSent, setSessionSent] = useState(0);
  const sessionStart = useRef<number | null>(null);
  const [goalCelebrated, setGoalCelebrated] = useState(false);
  const [celebration, setCelebration] = useState<{ title: string; detail: string } | null>(null);
  const [failedWrites, setFailedWrites] = useState<UpdateBody[]>([]);
  const [retrying, setRetrying] = useState(false);

  // New contacts sort + filter
  const [newSort, setNewSort] = useState<NewSort>('recent');
  const [newFilterList, setNewFilterList] = useState('');
  const [newFilterFunction, setNewFilterFunction] = useState('');

  // Today tab
  const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(new Set());
  const seededExpand = useRef(false);
  const [tierFilter, setTierFilter] = useState<Tier | null>(null);
  const [activeMenu, setActiveMenu] = useState<{ rowIndex: number; type: 'snooze' | 'replied' } | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState('');
  const [commentDrafts, setCommentDrafts] = useState<Record<number, string>>({});
  const [companyNotesDrafts, setCompanyNotesDrafts] = useState<Record<string, string>>({});
  const [emailBusy, setEmailBusy] = useState<Record<number, 'enriching' | 'drafting'>>({});
  const [toast, setToast] = useState<{ msg: string; kind: 'ok' | 'err' } | null>(null);

  // Message picker on contact card
  const [selectedMessage, setSelectedMessage] = useState('');

  // All tab inline edit
  const [editingRowIndex, setEditingRowIndex] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [saveLoading, setSaveLoading] = useState(false);

  const [copied, setCopied] = useState(false);
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sheetRes, cakeRes] = await Promise.all([
        fetch('/api/sheet'),
        fetch('/api/cake-images'),
      ]);
      const json = await sheetRes.json();
      if (json.error) throw new Error(json.error);
      setData(json);
      setIndex(0);
      setDismissed(new Set());
      setLocalEvents([]);
      const cakeJson = await cakeRes.json();
      if (!cakeJson.error) setCakeImages(cakeJson.images ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  // Background refresh on return-to-app: no spinner, no reset of
  // index/dismissed/combo — just pulls in any changes made elsewhere
  const silentRefresh = useCallback(async () => {
    try {
      const [sheetRes, cakeRes] = await Promise.all([
        fetch('/api/sheet'),
        fetch('/api/cake-images'),
      ]);
      const json = await sheetRes.json();
      if (json.error) return;
      setData(json);
      const cakeJson = await cakeRes.json();
      if (!cakeJson.error) setCakeImages(cakeJson.images ?? []);
    } catch {
      // keep showing stale data rather than erroring out a background refresh
    }
  }, []);

  const lastLoadedAt = useRef(0);
  const silentRefreshRef = useRef(silentRefresh);
  silentRefreshRef.current = silentRefresh;

  useEffect(() => {
    load();
    lastLoadedAt.current = Date.now();
  }, [load]);

  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastLoadedAt.current < 60_000) return;
      lastLoadedAt.current = Date.now();
      silentRefreshRef.current();
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  useEffect(() => {
    setCopied(false);
    setSelectedMessage('');
    if (copyTimeout.current) clearTimeout(copyTimeout.current);
  }, [index, tab, dismissed]);

  useEffect(() => {
    if (!celebration) return;
    const t = setTimeout(() => setCelebration(null), 4000);
    return () => clearTimeout(t);
  }, [celebration]);

  useEffect(() => {
    if (!toast) return;
    const lines = toast.msg.split('\n').length;
    const t = setTimeout(() => setToast(null), 4000 + (lines - 1) * 2000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (seededExpand.current || !data?.focus || data.focus.length === 0) return;
    seededExpand.current = true;
    setExpandedCompanies(new Set([data.focus[0].company]));
  }, [data]);

  // Build cake image lookup map
  const cakeImageMap: Record<string, CakeImage> = Object.fromEntries(
    cakeImages.map(img => [normalizeForMatch(img.name), img])
  );

  function getCake(company: string): CakeImage | null {
    return cakeImageMap[normalizeForMatch(company)] ?? null;
  }

  function getCakeLink(company: string): string | null {
    return getCake(company)?.viewLink ?? null;
  }

  // 06:00-21:59 favors UK contacts, 22:00-05:59 favors US contacts - recomputed
  // each render since it only depends on wall-clock time, not fetched data
  const regionMode = getRegionMode();

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
        // Primary: contacts with a cake image first
        const aHasCake = !!getCakeLink(a.company);
        const bHasCake = !!getCakeLink(b.company);
        if (aHasCake !== bHasCake) return aHasCake ? -1 : 1;
        // Secondary: region matching the current time-of-day window
        const ra = regionSortRank(a.region, regionMode);
        const rb = regionSortRank(b.region, regionMode);
        if (ra !== rb) return ra - rb;
        // Tertiary: user-chosen sort
        if (newSort === 'az') return a.company.localeCompare(b.company);
        const da = parseDate(a.connectedOn);
        const db = parseDate(b.connectedOn);
        if (!da || !db) return a.company.localeCompare(b.company);
        return newSort === 'recent'
          ? db.getTime() - da.getTime()
          : da.getTime() - db.getTime();
      });
  })();

  function followUpStageKey(c: Contact): ExperimentStage {
    return !c.followUpMessage1 ? 'followup1' : 'followup2';
  }

  // Follow-ups arrive pre-sorted by cadence priority (server-side); a stable
  // sort layers two things on top without disturbing that ordering within
  // each bucket: contacts due at a stage with an active A/B test are pinned
  // first (so they're not buried in the general queue), then region
  // preference for the current time-of-day window
  const sortedFollowUps = data
    ? [...data.followUps].sort((a, b) => {
        const aPinned = getActiveExperiment(data.experiments, followUpStageKey(a)) ? 0 : 1;
        const bPinned = getActiveExperiment(data.experiments, followUpStageKey(b)) ? 0 : 1;
        if (aPinned !== bPinned) return aPinned - bPinned;
        return regionSortRank(a.region, regionMode) - regionSortRank(b.region, regionMode);
      })
    : [];

  const queue = data
    ? (tab === 'followup' ? sortedFollowUps : sortedNewContacts).filter(
        c => !dismissed.has(c.rowIndex)
      )
    : [];

  const dailyNewGoal = data?.dailyNewGoal ?? 25;
  const stats: Stats | null = data
    ? getStats(data.allContacts, [...(data.activity ?? []), ...localEvents], dailyNewGoal)
    : null;

  const followUpsRemaining = data
    ? data.followUps.filter(c => !dismissed.has(c.rowIndex)).length
    : 0;
  const followUpsDueTotal = followUpsRemaining + (stats?.todayFollowUps ?? 0);
  const todayNew = stats?.todayNew ?? 0;

  useEffect(() => {
    if (!data || goalCelebrated || todayNew < dailyNewGoal) return;
    setGoalCelebrated(true);
    // celebrate only when the goal is crossed during use, not when loading an already-complete day
    if (sessionSent > 0) {
      const mins = sessionStart.current
        ? Math.max(1, Math.round((Date.now() - sessionStart.current) / 60000))
        : null;
      setCelebration({
        title: '🎯 Daily goal smashed!',
        detail: `${dailyNewGoal} new contacts messaged today${mins !== null ? ` — ${sessionSent} this session in ${mins} min` : ''}`,
      });
    }
  }, [data, todayNew, dailyNewGoal, goalCelebrated, sessionSent]);

  const safeIndex = Math.min(index, Math.max(0, queue.length - 1));
  const contact = queue[safeIndex] ?? null;

  const followUpStage = tab !== 'followup' || !contact ? 0
    : nextFollowUpStage(contact) ?? FOLLOW_UP_MAX + 1;

  // Active A/B test (if any) for whichever stage the current card is at -
  // up to three can run at once (new/followup1/followup2 independently)
  const currentStageKey: ExperimentStage | null =
    tab === 'new' ? 'new' : tab === 'followup' && followUpStage === 1 ? 'followup1' : tab === 'followup' && followUpStage === 2 ? 'followup2' : null;
  const activeExperiment = currentStageKey && data ? getActiveExperiment(data.experiments, currentStageKey) : null;

  const baseSuggestion: SuggestedMessage | null =
    contact && data
      ? suggestMessage(contact, data.allContacts, data.messages, tab === 'followup')
      : null;

  // Overrides the normal reply-rate-based suggestion with this contact's
  // assigned variant, so running a test doesn't just add another option -
  // it becomes the default, same as Lewis would send by hand
  const testVariantAbbr = activeExperiment && contact ? assignedTemplate(activeExperiment, contact.rowIndex) : null;
  const testVariantMessage = testVariantAbbr
    ? data?.messages.find(m => normAbbr(m.abbreviation) === normAbbr(testVariantAbbr)) ?? null
    : null;
  const testVariantResult = activeExperiment ? data?.experimentResults.find(r => r.testId === activeExperiment.testId) ?? null : null;
  const testVariantStats = testVariantResult && testVariantAbbr
    ? (normAbbr(testVariantResult.a.template) === normAbbr(testVariantAbbr) ? testVariantResult.a : testVariantResult.b)
    : null;

  const suggestion: SuggestedMessage | null = testVariantMessage
    ? {
        abbreviation: testVariantMessage.abbreviation,
        fullMessage: testVariantMessage.fullMessage,
        replyRate: testVariantStats?.rate ?? null,
        sentCount: testVariantStats?.sent ?? 0,
        repliedCount: testVariantStats?.replied ?? 0,
      }
    : baseSuggestion;

  const messageOptions = data?.messages.filter(m =>
    tab === 'new'
      ? m.messageType === 'Initial Outreach'
      : m.messageType === 'Follow Up'
  ) ?? [];

  const focusGroups: CompanyGroup[] = (data?.focus ?? [])
    .map(g => ({ ...g, contacts: g.contacts.filter(c => !dismissed.has(c.rowIndex)) }))
    .filter(g => g.contacts.length > 0);
  const focusContactCount = focusGroups.reduce((n, g) => n + g.contacts.length, 0);

  const repliedQueue = data ? getRepliedQueue(data.allContacts) : [];

  async function updateSheet(
    rowIndex: number,
    cells: { col: string; value: string }[],
    log?: { action: string; template?: string; detail?: string; name?: string; company?: string }
  ) {
    const payload: UpdateBody = {
      rowIndex,
      cells,
      log: log
        ? {
            date: todayDMY(),
            rowIndex,
            name: log.name ?? '',
            company: log.company ?? '',
            action: log.action,
            template: log.template ?? '',
            detail: log.detail ?? '',
          }
        : undefined,
    };
    const ok = await postUpdate(payload);
    if (!ok) setFailedWrites(prev => [...prev, payload]);
  }

  async function updateCampaign(company: string, updates: { status?: string; notes?: string; focus?: boolean }) {
    const payload: UpdateBody = { campaign: { company, ...updates } };
    const ok = await postUpdate(payload);
    if (!ok) setFailedWrites(prev => [...prev, payload]);
  }

  // Prospect mutations are company-level — the Apps Script updates every
  // contact row for that company, so local state mirrors the whole group.
  async function updateProspect(company: string, updates: Partial<Omit<NonNullable<UpdateBody['prospect']>, 'company'>>) {
    setData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        prospects: prev.prospects.map(p =>
          p.company !== company
            ? p
            : {
                ...p,
                ...(updates.status !== undefined ? { status: updates.status } : {}),
                ...(updates.rejectionReason !== undefined ? { rejectionReason: updates.rejectionReason } : {}),
                ...(updates.channel !== undefined ? { channel: updates.channel } : {}),
                ...(updates.address !== undefined ? { address: updates.address } : {}),
                ...(updates.addressConfirmedBy !== undefined ? { addressConfirmedBy: updates.addressConfirmedBy } : {}),
              }
        ),
      };
    });
    const payload: UpdateBody = { prospect: { company, ...updates } };
    const ok = await postUpdate(payload);
    if (!ok) setFailedWrites(prev => [...prev, payload]);
  }

  function handleApproveProspect(company: string, channel: ProspectChannel) {
    updateProspect(company, { status: 'Approved', rejectionReason: '', channel, dateReviewed: todayDMY() });
  }

  function handleRejectProspect(company: string, reason: string) {
    updateProspect(company, { status: 'Rejected', rejectionReason: reason, dateReviewed: todayDMY() });
  }

  function handleSaveProspectAddress(company: string, address: string, confirmedBy: string) {
    updateProspect(company, {
      address,
      addressConfirmedBy: confirmedBy,
      status: address && confirmedBy ? 'Ready to send' : 'Approved',
    });
  }

  // Graduation: the prospect becomes a real Campaigns row at Delivered (the
  // Apps Script stamps the cake-sent date on that first transition), and
  // drops off the Prospects list so it isn't tracked in two places.
  async function handleProspectCakeSent(company: string) {
    await updateProspect(company, { status: 'Graduated' });
    await updateCampaign(company, { status: 'Delivered' });
    await syncPriority(company);
    await silentRefresh();
    setToast({ msg: `${company} moved into Campaigns as Delivered`, kind: 'ok' });
  }

  async function handleCreateExperiment(params: { name: string; stage: ExperimentStage; variantA: string; variantB: string }) {
    const testId = `test-${Date.now()}`;
    const newExperiment: Experiment = {
      testId,
      name: params.name,
      stage: params.stage,
      variantA: params.variantA,
      variantB: params.variantB,
      status: 'Active',
      started: todayDMY(),
      ended: '',
      winner: '',
      notes: '',
    };
    setData(prev => (prev ? { ...prev, experiments: [...prev.experiments, newExperiment] } : prev));
    const payload: UpdateBody = {
      experiment: {
        testId,
        name: params.name,
        stage: params.stage,
        variantA: params.variantA,
        variantB: params.variantB,
        status: 'Active',
        started: newExperiment.started,
      },
    };
    const ok = await postUpdate(payload);
    if (!ok) setFailedWrites(prev => [...prev, payload]);
    await silentRefresh();
  }

  async function handleEndExperiment(testId: string, winner: string) {
    const ended = todayDMY();
    setData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        experiments: prev.experiments.map(e => (e.testId === testId ? { ...e, status: 'Completed', ended, winner } : e)),
      };
    });
    const payload: UpdateBody = { experiment: { testId, status: 'Completed', ended, winner } };
    const ok = await postUpdate(payload);
    if (!ok) setFailedWrites(prev => [...prev, payload]);
    await silentRefresh();
  }

  async function retryFailedWrites() {
    if (retrying || failedWrites.length === 0) return;
    setRetrying(true);
    const pending = failedWrites;
    setFailedWrites([]);
    const stillFailed: UpdateBody[] = [];
    for (const p of pending) {
      if (!(await postUpdate(p))) stillFailed.push(p);
    }
    setFailedWrites(prev => [...stillFailed, ...prev]);
    setRetrying(false);
  }

  function handleLinkedIn(c: Contact) {
    if (!c.url) return;
    window.open(c.url, '_blank');
  }

  function setContactEmail(rowIndex: number, email: string) {
    setData(prev => {
      if (!prev) return prev;
      const upd = <T extends Contact>(x: T): T => (x.rowIndex !== rowIndex ? x : { ...x, email });
      return {
        ...prev,
        allContacts: prev.allContacts.map(upd),
        focus: prev.focus.map(g => ({ ...g, contacts: g.contacts.map(upd) })),
      };
    });
  }

  async function handleDraftEmail(c: Contact) {
    if (emailBusy[c.rowIndex]) return;
    setEmailBusy(prev => ({ ...prev, [c.rowIndex]: 'drafting' }));
    try {
      const res = await fetch('/api/draft-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowIndex: c.rowIndex }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || 'Draft failed');
      const warnings: string[] = json.warnings ?? [];
      const msg = [`Draft for ${c.fullName} is in your Gmail drafts`, ...warnings.map(w => `⚠ ${w}`)].join('\n');
      setToast({ msg, kind: 'ok' });

      // A created draft counts as touching the contact today - the server
      // already stamped Last Contacted, mirror it locally so the queue and
      // cadence reflect it immediately instead of waiting on a refetch.
      const today = todayDMY();
      setData(prev => {
        if (!prev) return prev;
        const upd = <T extends Contact>(x: T): T => (x.rowIndex !== c.rowIndex ? x : { ...x, lastContacted: today });
        return {
          ...prev,
          allContacts: prev.allContacts.map(upd),
          followUps: prev.followUps.map(upd),
          newContacts: prev.newContacts.map(upd),
          focus: prev.focus.map(g => ({ ...g, contacts: g.contacts.map(upd) })),
        };
      });
      setDismissed(prev => new Set(prev).add(c.rowIndex));
      const newQueue = queue.filter(q => q.rowIndex !== c.rowIndex);
      setIndex(i => Math.min(i, Math.max(0, newQueue.length - 1)));
      setCombo(x => x + 1);
    } catch (e: unknown) {
      setToast({ msg: e instanceof Error ? e.message : 'Draft failed', kind: 'err' });
    } finally {
      setEmailBusy(prev => {
        const next = { ...prev };
        delete next[c.rowIndex];
        return next;
      });
    }
  }

  async function handleFindEmail(c: Contact) {
    if (emailBusy[c.rowIndex]) return;
    setEmailBusy(prev => ({ ...prev, [c.rowIndex]: 'enriching' }));
    try {
      // A bare company name is a weak match signal (e.g. "Metaview" got mismatched
      // to "Meta") - if a colleague at the same company already has a verified
      // email on file, hand FullEnrich that domain too for a much stronger match.
      const companyKey = normAbbr(c.company);
      const colleagueDomain = (data?.allContacts ?? [])
        .find(x => x.rowIndex !== c.rowIndex && normAbbr(x.company) === companyKey && x.email.includes('@'))
        ?.email.split('@')[1];

      const startRes = await fetch('/api/enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rowIndex: c.rowIndex,
          firstName: c.firstName,
          lastName: c.lastName,
          company: c.company,
          linkedinUrl: c.url,
          domain: colleagueDomain,
        }),
      });
      const startJson = await startRes.json();
      if (!startRes.ok || startJson.error) throw new Error(startJson.error || 'Enrichment failed to start');

      // The server writes the email + triggers the draft as soon as it sees FINISHED
      // (whether via this poll or the FullEnrich webhook, whichever gets there first) -
      // if this tab closes or the phone locks mid-poll, the webhook still finishes the job.
      let email: string | null = null;
      let drafted = false;
      for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const pollRes = await fetch(`/api/enrich?id=${encodeURIComponent(startJson.enrichmentId)}&rowIndex=${c.rowIndex}`);
        const pollJson = await pollRes.json();
        if (pollJson.error) throw new Error(pollJson.error);
        if (pollJson.status === 'FINISHED') {
          email = pollJson.email;
          drafted = !!pollJson.drafted;
          break;
        }
        if (['CANCELED', 'CREDITS_INSUFFICIENT', 'RATE_LIMIT'].includes(pollJson.status)) {
          throw new Error(`Enrichment ${pollJson.status.toLowerCase().replace(/_/g, ' ')}`);
        }
      }

      if (!email) {
        setToast({ msg: `No email found for ${c.fullName}`, kind: 'err' });
        return;
      }
      setContactEmail(c.rowIndex, email);
      setToast({
        msg: drafted ? `Found ${email} — draft saved to Gmail` : `Found ${email}`,
        kind: 'ok',
      });
    } catch (e: unknown) {
      setToast({ msg: e instanceof Error ? e.message : 'Enrichment failed', kind: 'err' });
    } finally {
      setEmailBusy(prev => {
        const next = { ...prev };
        delete next[c.rowIndex];
        return next;
      });
    }
  }

  function handleCallContact(c: Contact) {
    if (!c.phone) return;
    window.location.href = `tel:${c.phone}`;
  }

  // Resolves a field to its live column letter — the sheet is read by header
  // name (see buildConnectionsColumnMap), so column order never needs to
  // match this component. An empty return means the header wasn't found,
  // which surfaces as a visible failed write rather than silently hitting
  // the wrong cell.
  function col(field: string): string {
    return data?.columns[field] ?? '';
  }

  async function handleFocusDone(c: Contact, note: string = '') {
    const cells: { col: string; value: string }[] = [{ col: col('lastContacted'), value: todayDMY() }];
    let actionType: string;
    let newFollowUpCount: number | null = null;
    let messageField: 'message' | FollowUpFieldKey | null = null;

    if (!c.message) {
      cells.push({ col: col('message'), value: 'One-off' });
      messageField = 'message';
      actionType = 'new';
    } else {
      newFollowUpCount = (parseInt(c.followUps) || 0) + 1;
      cells.push({ col: col('followUps'), value: String(newFollowUpCount) });
      const stage = nextFollowUpStage(c);
      const fieldKey = stage ? followUpFieldKey(stage) : null;
      if (fieldKey) {
        cells.push({ col: col(fieldKey), value: 'One-off' });
        messageField = fieldKey;
        actionType = `followup${stage}`;
      } else {
        actionType = `followup${FOLLOW_UP_MAX + 1}`;
      }
    }

    // A note logged alongside a one-off touch (e.g. from the Replied tab's
    // "Log follow-up" button) is appended to the persistent Comment field
    // so it's visible on the contact at a glance, not just buried in the
    // Activity log.
    const trimmedNote = note.trim();
    const newComment = trimmedNote
      ? `${c.comment ? `${c.comment} | ` : ''}${todayDMY()}: ${trimmedNote}`
      : null;
    if (newComment !== null) cells.push({ col: col('comment'), value: newComment });

    await updateSheet(c.rowIndex, cells, {
      action: actionType,
      template: 'One-off',
      name: c.fullName,
      company: c.company,
      detail: trimmedNote,
    });

    setData(prev => {
      if (!prev) return prev;
      const upd = (x: Contact) =>
        x.rowIndex !== c.rowIndex
          ? x
          : {
              ...x,
              lastContacted: todayDMY(),
              ...(newFollowUpCount !== null ? { followUps: String(newFollowUpCount) } : {}),
              ...(messageField ? { [messageField]: 'One-off' } : {}),
              ...(newComment !== null ? { comment: newComment } : {}),
            };
      return { ...prev, allContacts: prev.allContacts.map(upd) };
    });
    setDismissed(prev => new Set(prev).add(c.rowIndex));
  }

  async function handleSnooze(c: Contact, days: number) {
    const until = new Date();
    until.setDate(until.getDate() + days);
    const untilStr = `${String(until.getDate()).padStart(2, '0')}/${String(until.getMonth() + 1).padStart(2, '0')}/${until.getFullYear()}`;

    await updateSheet(c.rowIndex, [], {
      action: 'snooze',
      detail: untilStr,
      name: c.fullName,
      company: c.company,
    });
    setDismissed(prev => new Set(prev).add(c.rowIndex));
    setActiveMenu(null);
  }

  function companyIsActive(company: string): boolean {
    const campaign = data?.campaigns.find(camp => normAbbr(camp.company) === normAbbr(company));
    return campaign ? isCampaignActive(campaign.status) : false;
  }

  async function syncPriority(company: string) {
    try {
      await fetch('/api/sync-priority', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company }),
      });
    } catch {
      // best-effort — Priority is a visibility aid, not load-bearing for the app itself
    }
  }

  async function handleReplied(c: Contact, value: 'Interested' | 'Not interested') {
    const priority = computePriorityLabel({ ...c, reply: value }, companyIsActive(c.company));
    await updateSheet(c.rowIndex, [{ col: col('reply'), value }, { col: col('priority'), value: priority }], {
      action: 'reply',
      detail: value,
      name: c.fullName,
      company: c.company,
    });
    setData(prev => {
      if (!prev) return prev;
      const upd = (x: Contact) => (x.rowIndex !== c.rowIndex ? x : { ...x, reply: value, priority });
      return { ...prev, allContacts: prev.allContacts.map(upd) };
    });
    setDismissed(prev => new Set(prev).add(c.rowIndex));
    setActiveMenu(null);
    if (value === 'Interested') {
      setCelebration({ title: '\u{1F389} Interested!', detail: `${c.fullName} at ${c.company} is interested` });
    }
  }

  async function handleMeetingBooked(c: Contact) {
    await updateSheet(c.rowIndex, [{ col: col('callBooked'), value: todayDMY() }], {
      action: 'callbooked',
      name: c.fullName,
      company: c.company,
    });
    setData(prev => {
      if (!prev) return prev;
      const upd = (x: Contact) => (x.rowIndex !== c.rowIndex ? x : { ...x, callBooked: todayDMY() });
      return { ...prev, allContacts: prev.allContacts.map(upd) };
    });
    setDismissed(prev => new Set(prev).add(c.rowIndex));
    setActiveMenu(null);
    setCelebration({ title: '\u{1F4C5} Meeting booked!', detail: `${c.fullName} at ${c.company} — nice work` });
  }

  async function handleAddToFocus(companyArg?: string) {
    const company = (companyArg ?? newCompanyName).trim();
    if (!company) return;
    setNewCompanyName('');
    setData(prev => {
      if (!prev) return prev;
      const existing = prev.campaigns.find(c => normAbbr(c.company) === normAbbr(company));
      const campaigns = existing
        ? prev.campaigns.map(c => (c === existing ? { ...c, focus: true } : c))
        : [...prev.campaigns, { company, status: '', cakeSentDate: '', notes: '', industry: '', companySize: '', fundingStage: '', region: '', icpFit: '', focus: true }];
      return { ...prev, campaigns };
    });
    await updateCampaign(company, { focus: true });
    await syncPriority(company);
    // the shortlist change affects Focus's grouping, which is computed
    // server-side — refetch so the new company's contacts appear
    await silentRefresh();
  }

  async function handleRemoveFromFocus(company: string) {
    setData(prev => {
      if (!prev) return prev;
      return { ...prev, campaigns: prev.campaigns.map(c => (c.company === company ? { ...c, focus: false } : c)) };
    });
    await updateCampaign(company, { focus: false });
    await syncPriority(company);
    await silentRefresh();
  }

  async function handleSetCompanyStage(company: string, status: string) {
    setData(prev => {
      if (!prev) return prev;
      return { ...prev, campaigns: prev.campaigns.map(c => (c.company === company ? { ...c, status } : c)) };
    });
    await updateCampaign(company, { status });
    await syncPriority(company);
    await silentRefresh();
  }

  async function handleSaveCompanyNotes(company: string, notes: string) {
    setData(prev => {
      if (!prev) return prev;
      return { ...prev, campaigns: prev.campaigns.map(c => (c.company === company ? { ...c, notes } : c)) };
    });
    await updateCampaign(company, { notes });
  }

  async function handleSaveComment(c: Contact) {
    const value = commentDrafts[c.rowIndex] ?? c.comment;
    await updateSheet(c.rowIndex, [{ col: col('comment'), value }]);
    setData(prev => {
      if (!prev) return prev;
      const upd = <T extends Contact>(x: T) => (x.rowIndex !== c.rowIndex ? x : { ...x, comment: value });
      return {
        ...prev,
        allContacts: prev.allContacts.map(upd),
        focus: prev.focus.map(g => ({ ...g, contacts: g.contacts.map(upd) })),
      };
    });
  }

  // Optimistic: advances the queue immediately and fires the sheet write in
  // the background rather than awaiting it - a slow Apps Script round trip
  // (2-3s) shouldn't hold up the next card. Write failures still surface via
  // the existing failedWrites banner/retry, same as everywhere else.
  function handleAction(action: 'contacted' | 'dead', deadReason?: string) {
    if (!contact) return;

    const c = contact;
    const cells: { col: string; value: string }[] = [];

    if (action === 'contacted') {
      const templateUsed = selectedMessage || suggestion?.abbreviation || '';
      const actionType = tab === 'new' ? 'new' : `followup${followUpStage}`;
      const fieldKey = tab === 'followup' ? followUpFieldKey(followUpStage) : null;

      if (templateUsed) {
        if (tab === 'new') cells.push({ col: col('message'), value: templateUsed });
        else if (fieldKey) cells.push({ col: col(fieldKey), value: templateUsed });
      }
      const newFollowUpCount = tab === 'followup' ? (parseInt(c.followUps) || 0) + 1 : null;
      if (newFollowUpCount !== null) cells.push({ col: col('followUps'), value: String(newFollowUpCount) });
      cells.push({ col: col('lastContacted'), value: todayDMY() });

      updateSheet(c.rowIndex, cells, {
        action: actionType,
        template: templateUsed,
        name: c.fullName,
        company: c.company,
      });

      setLocalEvents(prev => [
        ...prev,
        { date: todayDMY(), rowIndex: c.rowIndex, action: actionType, template: templateUsed, detail: '' },
      ]);
      setData(prev => {
        if (!prev) return prev;
        const upd = (x: Contact) =>
          x.rowIndex !== c.rowIndex
            ? x
            : {
                ...x,
                lastContacted: todayDMY(),
                ...(newFollowUpCount !== null ? { followUps: String(newFollowUpCount) } : {}),
                ...(templateUsed && tab === 'new' ? { message: templateUsed } : {}),
                ...(templateUsed && tab === 'followup' && fieldKey ? { [fieldKey]: templateUsed } : {}),
              };
        return {
          ...prev,
          allContacts: prev.allContacts.map(upd),
          followUps: prev.followUps.map(upd),
          newContacts: prev.newContacts.map(upd),
        };
      });

      if (!sessionStart.current) sessionStart.current = Date.now();
      setSessionSent(s => s + 1);
      setCombo(x => x + 1);
    } else {
      const reason = deadReason || 'Dead lead';
      cells.push({ col: col('reply'), value: reason });
      updateSheet(c.rowIndex, cells, {
        action: 'reply',
        detail: reason,
        name: c.fullName,
        company: c.company,
      });
    }

    setDismissed(prev => new Set(prev).add(c.rowIndex));
    const newQueue = queue.filter(q => q.rowIndex !== c.rowIndex);
    setIndex(i => Math.min(i, Math.max(0, newQueue.length - 1)));
    setSelectedMessage('');
  }

  function handleCopy() {
    if (!suggestion?.fullMessage) return;
    navigator.clipboard.writeText(suggestion.fullMessage).then(() => {
      setCopied(true);
      if (copyTimeout.current) clearTimeout(copyTimeout.current);
      copyTimeout.current = setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleCopyOpen() {
    if (!suggestion?.fullMessage || !contact) return;
    const url = contact.url;
    navigator.clipboard.writeText(suggestion.fullMessage).then(() => {
      setCopied(true);
      if (copyTimeout.current) clearTimeout(copyTimeout.current);
      copyTimeout.current = setTimeout(() => setCopied(false), 2500);
      if (url) window.open(url, '_blank');
    });
  }

  function handleTabSwitch(t: Tab) {
    setTab(t);
    setIndex(0);
    setEditingRowIndex(null);
    setCombo(0);
  }

  function openEdit(c: Contact) {
    setEditingRowIndex(c.rowIndex);
    setEditValues({
      list: c.list,
      function: c.function,
      message: c.message,
      reply: c.reply,
      ...Object.fromEntries(FOLLOW_UP_FIELD_KEYS.map(k => [k, c[k]])),
      lastContacted: c.lastContacted,
      comment: c.comment,
    });
  }

  async function saveEdit() {
    if (editingRowIndex === null || saveLoading || !data) return;
    setSaveLoading(true);

    const cells = Object.entries(editValues).map(([field, value]) => ({
      col: col(field),
      value,
    }));

    const prevContact = data.allContacts.find(c => c.rowIndex === editingRowIndex);
    const replyChanged = !!prevContact && editValues.reply !== prevContact.reply;
    const becameInterested =
      replyChanged &&
      editValues.reply.toLowerCase() === 'interested' &&
      prevContact!.reply.toLowerCase() !== 'interested';
    const creditedTemplate =
      [...FOLLOW_UP_FIELD_KEYS].reverse().map(k => editValues[k]).find(Boolean) || editValues.message || '';

    let newPriority: string | null = null;
    if (replyChanged && prevContact) {
      newPriority = computePriorityLabel({ ...prevContact, reply: editValues.reply }, companyIsActive(prevContact.company));
      cells.push({ col: col('priority'), value: newPriority });
    }

    await updateSheet(
      editingRowIndex,
      cells,
      replyChanged && editValues.reply
        ? {
            action: 'reply',
            detail: editValues.reply,
            template: creditedTemplate,
            name: prevContact?.fullName,
            company: prevContact?.company,
          }
        : undefined
    );

    const updateContact = (c: Contact) =>
      c.rowIndex !== editingRowIndex ? c : {
        ...c,
        list: editValues.list,
        function: editValues.function,
        message: editValues.message,
        reply: editValues.reply,
        ...Object.fromEntries(FOLLOW_UP_FIELD_KEYS.map(k => [k, editValues[k]])),
        lastContacted: editValues.lastContacted,
        comment: editValues.comment,
        ...(newPriority !== null ? { priority: newPriority } : {}),
      };
    const updatedAll = data.allContacts.map(updateContact);

    setData({
      ...data,
      allContacts: updatedAll,
      followUps: data.followUps.map(updateContact),
      newContacts: data.newContacts.map(updateContact),
    });

    if (becameInterested && prevContact) {
      const s = creditedTemplate
        ? getMessageStats(updatedAll, data.messages).find(m => normAbbr(m.abbreviation) === normAbbr(creditedTemplate))
        : undefined;
      setCelebration({
        title: '🎉 Interested!',
        detail:
          s && s.sent > 0
            ? `'${creditedTemplate}' is now at ${Math.round((s.replied / s.sent) * 100)}% reply rate (${s.replied}/${s.sent})`
            : `${prevContact.fullName} is interested`,
      });
    }

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
        {stats && (
          <div className={styles.goalBar}>
            <GoalRing value={todayNew} max={dailyNewGoal} label="New today" />
            <GoalRing value={stats.todayFollowUps} max={followUpsDueTotal} label="Follow-ups" />
            <div className={styles.goalBarRight}>
              <span className={styles.regionChip} title="Which region's contacts are sorted first right now">
                {regionMode === 'uk' ? '🇬🇧 UK hours' : '🇺🇸 US hours'}
              </span>
              {combo >= 2 && <span className={styles.comboChip}>⚡ {combo}</span>}
              <span className={`${styles.streakChip} ${stats.streak === 0 ? styles.streakZero : ''}`}>
                🔥 {stats.streak}
              </span>
            </div>
          </div>
        )}
        <div className={styles.tabs}>
          <button className={`${styles.tab} ${tab === 'followup' ? styles.tabActive : ''}`} onClick={() => handleTabSwitch('followup')}>
            Follow-ups
            <span className={styles.tabCount}>{data ? data.followUps.filter(c => !dismissed.has(c.rowIndex)).length : 0}</span>
          </button>
          <button className={`${styles.tab} ${tab === 'new' ? styles.tabActive : ''}`} onClick={() => handleTabSwitch('new')}>
            New
            <span className={styles.tabCount}>{data ? sortedNewContacts.filter(c => !dismissed.has(c.rowIndex)).length : 0}</span>
          </button>
          <button className={`${styles.tab} ${tab === 'focus' ? styles.tabActive : ''}`} onClick={() => handleTabSwitch('focus')}>
            Focus
            <span className={styles.tabCount}>{focusContactCount}</span>
          </button>
          <button className={`${styles.tab} ${tab === 'connections' ? styles.tabActive : ''}`} onClick={() => handleTabSwitch('connections')}>
            All
            <span className={styles.tabCount}>{data ? data.allContacts.length : 0}</span>
          </button>
          <div className={styles.moreMenuWrap}>
            <button
              className={`${styles.tab} ${MORE_TABS.some(m => m.tab === tab) ? styles.tabActive : ''}`}
              onClick={() => setMoreMenuOpen(o => !o)}
            >
              ⋯
            </button>
            {moreMenuOpen && (
              <div className={styles.moreMenu}>
                {MORE_TABS.map(m => (
                  <button
                    key={m.tab}
                    className={`${styles.moreMenuItem} ${tab === m.tab ? styles.moreMenuItemActive : ''}`}
                    onClick={() => { handleTabSwitch(m.tab); setMoreMenuOpen(false); }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      {failedWrites.length > 0 && (
        <div className={styles.syncBanner}>
          <span>
            {failedWrites.length} update{failedWrites.length !== 1 ? 's' : ''} failed to save to the sheet
          </span>
          <button className={styles.syncRetryBtn} onClick={retryFailedWrites} disabled={retrying}>
            {retrying ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      )}

      {/* Main content */}
      <main className={styles.main}>

        {/* ── CAKE TAB ── */}
        {tab === 'cake' ? (
          <CakeTab />
        )

        /* ── STATS TAB ── */
        : tab === 'stats' ? (
          stats ? <StatsTab stats={stats} allContacts={data?.allContacts ?? []} /> : null
        )

        /* ── ALL CONTACTS TAB ── */
        : tab === 'connections' ? (
          <ConnectionsTab
            allContacts={data?.allContacts ?? []}
            messageAbbrs={data?.messages.map(m => m.abbreviation) ?? []}
            intervalDays={intervalDays}
            editingRowIndex={editingRowIndex}
            editValues={editValues}
            saveLoading={saveLoading}
            onOpenEdit={openEdit}
            onCloseEdit={() => setEditingRowIndex(null)}
            onEditValueChange={(field, value) => setEditValues(v => ({ ...v, [field]: value }))}
            onSaveEdit={saveEdit}
          />
        )

        /* ── MESSAGES TAB ── */
        : tab === 'messages' ? (
          <MessagesTab allContacts={data?.allContacts ?? []} messages={data?.messages ?? []} />
        )

        /* ── PROSPECTS TAB ── */
        : tab === 'prospects' ? (
          <ProspectsTab
            prospects={data?.prospects ?? []}
            onApprove={handleApproveProspect}
            onReject={handleRejectProspect}
            onSaveAddress={handleSaveProspectAddress}
            onCakeSent={handleProspectCakeSent}
          />
        )

        /* ── TESTS TAB ── */
        : tab === 'tests' ? (
          <TestsTab
            experiments={data?.experiments ?? []}
            results={data?.experimentResults ?? []}
            messages={data?.messages ?? []}
            onCreate={handleCreateExperiment}
            onEnd={handleEndExperiment}
          />
        )

        /* ── FOCUS TAB ── */
        : tab === 'focus' ? (
          <FocusTab
            groups={focusGroups}
            suggestions={data?.focusSuggestions ?? []}
            allContacts={data?.allContacts ?? []}
            focusedCompanies={(data?.campaigns ?? []).filter(c => c.focus)}
            tierFilter={tierFilter}
            onTierFilterChange={setTierFilter}
            manageOpen={manageOpen}
            onToggleManage={() => setManageOpen(o => !o)}
            newCompanyName={newCompanyName}
            onNewCompanyNameChange={setNewCompanyName}
            onAddToFocus={handleAddToFocus}
            onRemoveFromFocus={handleRemoveFromFocus}
            onSetStage={handleSetCompanyStage}
            companyNotesDrafts={companyNotesDrafts}
            onNotesDraftChange={(company, value) => setCompanyNotesDrafts(prev => ({ ...prev, [company]: value }))}
            onSaveNotes={handleSaveCompanyNotes}
            expandedCompanies={expandedCompanies}
            onToggleExpanded={company => setExpandedCompanies(prev => {
              const next = new Set(prev);
              if (next.has(company)) next.delete(company); else next.add(company);
              return next;
            })}
            activeMenu={activeMenu}
            onSetActiveMenu={setActiveMenu}
            onSnooze={handleSnooze}
            onReplied={handleReplied}
            onMeetingBooked={handleMeetingBooked}
            onDone={handleFocusDone}
            commentDrafts={commentDrafts}
            onCommentDraftChange={(rowIndex, value) => setCommentDrafts(prev => ({ ...prev, [rowIndex]: value }))}
            onSaveComment={handleSaveComment}
            onLinkedIn={handleLinkedIn}
            onDraftEmail={handleDraftEmail}
            onFindEmail={handleFindEmail}
            onCallContact={handleCallContact}
            emailBusy={emailBusy}
          />
        )

        /* ── REPLIED (LIVE CONVERSATIONS) TAB ── */
        : tab === 'replied' ? (
          <RepliedTab
            contacts={repliedQueue}
            onReplied={handleReplied}
            onMeetingBooked={handleMeetingBooked}
            onLogFollowUp={handleFocusDone}
            commentDrafts={commentDrafts}
            onCommentDraftChange={(rowIndex, value) => setCommentDrafts(prev => ({ ...prev, [rowIndex]: value }))}
            onSaveComment={handleSaveComment}
            onLinkedIn={handleLinkedIn}
            onDraftEmail={handleDraftEmail}
            onFindEmail={handleFindEmail}
            onCallContact={handleCallContact}
            emailBusy={emailBusy}
          />
        )

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
                <div className={styles.cardBtns}>
                  {tab === 'new' && contact!.company && getCakeLink(contact!.company) && (
                    <a
                      className={styles.cakeBtn}
                      href={getCakeLink(contact!.company)!}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="View cake design"
                    >
                      🎂
                    </a>
                  )}
                  {contact!.email ? (
                    <button
                      className={`${styles.todayChannelBtn} ${styles.emailReadyBtn}`}
                      onClick={() => handleDraftEmail(contact!)}
                      disabled={!!emailBusy[contact!.rowIndex]}
                      aria-label="Draft email with AI"
                      title="AI-draft an email into your Gmail drafts"
                    >
                      {emailBusy[contact!.rowIndex] === 'drafting' ? (
                        <span className={styles.miniSpinner} />
                      ) : (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/></svg>
                      )}
                    </button>
                  ) : (
                    <button
                      className={styles.todayChannelBtn}
                      onClick={() => handleFindEmail(contact!)}
                      disabled={!!emailBusy[contact!.rowIndex]}
                      aria-label="Find email with FullEnrich"
                      title="Find this contact's email (uses FullEnrich credits)"
                    >
                      {emailBusy[contact!.rowIndex] === 'enriching' ? (
                        <span className={styles.miniSpinner} />
                      ) : (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="14" height="12" rx="2"/><path d="m16 7-7 4-7-4"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="m21 20 2 2"/></svg>
                      )}
                    </button>
                  )}
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

              {tab === 'new' && contact!.company && getCake(contact!.company) && (
                <a
                  className={styles.cakePreview}
                  href={getCake(contact!.company)!.viewLink}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`https://drive.google.com/thumbnail?id=${getCake(contact!.company)!.fileId}&sz=w600`}
                    alt={`Cake design for ${contact!.company}`}
                    loading="lazy"
                  />
                </a>
              )}
            </div>

            {/* Message suggestion */}
            {suggestion ? (
              <div className={styles.msgCard}>
                {activeExperiment && testVariantMessage && (
                  <span className={styles.testBadge}>
                    🧪 {activeExperiment.name} — Variant {assignVariant(contact!.rowIndex, activeExperiment.testId)}
                  </span>
                )}
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
                <div className={styles.msgBtnRow}>
                  <button
                    className={`${styles.primaryBtn} ${copied ? styles.primaryBtnDone : ''}`}
                    onClick={handleCopyOpen}
                  >
                    {copied ? (
                      <><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Copied — paste in LinkedIn</>
                    ) : (
                      <><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy &amp; open LinkedIn</>
                    )}
                  </button>
                  <button className={styles.copyOnlyBtn} onClick={handleCopy} title="Copy only" aria-label="Copy message only">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  </button>
                </div>
              </div>
            ) : (
              <div className={styles.msgCard}>
                <p className={styles.noTemplate}>No unused templates left for this contact — add more in the Messages sheet.</p>
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
            {followUpStage <= FOLLOW_UP_MAX && messageOptions.length > 0 && (
              <div className={styles.msgPickerRow}>
                <label className={styles.msgPickerLabel}>
                  {followUpStage === 0 ? 'Message sent' : `Follow up ${followUpStage}`}
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
            {followUpStage > FOLLOW_UP_MAX && (
              <div className={styles.secondFollowUpNote}>All {FOLLOW_UP_MAX} follow-ups sent — date only will be recorded</div>
            )}

            {/* Actions */}
            <div className={styles.actionRow}>
              <button
                className={`${styles.actionBtn} ${styles.contactedBtn}`}
                onClick={() => handleAction('contacted')}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                Sent
              </button>
              {tab === 'new' ? (
                <>
                  <button
                    className={`${styles.actionBtn} ${styles.deadBtn}`}
                    onClick={() => handleAction('dead', 'Wrong location')}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    Location
                  </button>
                  <button
                    className={`${styles.actionBtn} ${styles.deadBtn}`}
                    onClick={() => handleAction('dead', 'Wrong role')}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    Role
                  </button>
                  <button
                    className={`${styles.actionBtn} ${styles.deadBtn}`}
                    onClick={() => handleAction('dead', 'Wrong business')}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    Business
                  </button>
                </>
              ) : (
                <button
                  className={`${styles.actionBtn} ${styles.deadBtn}`}
                  onClick={() => handleAction('dead')}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  Dead lead
                </button>
              )}
            </div>
          </>
        )}
      </main>

      {celebration && (
        <div className={styles.celebrationOverlay} onClick={() => setCelebration(null)}>
          <div className={styles.confetti}>
            {Array.from({ length: 36 }).map((_, i) => (
              <span
                key={i}
                className={styles.confettiPiece}
                style={{
                  left: `${(i * 137) % 100}%`,
                  background: ['#4ade80', '#fbbf24', '#e8d5b0', '#f87171', '#60a5fa'][i % 5],
                  animationDelay: `${(i % 12) * 0.12}s`,
                  animationDuration: `${2.2 + (i % 5) * 0.3}s`,
                }}
              />
            ))}
          </div>
          <div className={styles.celebrationCard}>
            <div className={styles.celebrationTitle}>{celebration.title}</div>
            <div className={styles.celebrationDetail}>{celebration.detail}</div>
          </div>
        </div>
      )}

      {toast && (
        <div className={`${styles.toast} ${toast.kind === 'err' ? styles.toastErr : styles.toastOk}`} onClick={() => setToast(null)}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
