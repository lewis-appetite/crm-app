'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Contact, Message, SuggestedMessage, ActivityEvent, CompanyGroup, Tier, CampaignEntry,
  suggestMessage, daysAgo, parseDate, todayDMY, isCampaignClosed,
  getMessageStats, MessageStats, POSITIVE_REPLIES, normAbbr,
  getStats, Stats,
} from '@/lib/sheets';

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
  today: CompanyGroup[];
  messages: Message[];
  allContacts: Contact[];
  activity: ActivityEvent[];
  campaigns: CampaignEntry[];
  intervalDays: number;
  dailyNewGoal: number;
}

type Tab = 'followup' | 'new' | 'today' | 'messages' | 'cake' | 'connections' | 'stats';

const TIER_LABELS: Record<Tier, string> = {
  1: 'Cake sent',
  2: 'Interested, gone cold',
};
const TIER_ICONS: Record<Tier, string> = { 1: '\u{1F382}', 2: '\u{1F525}' };
const TIER_STYLE: Record<Tier, string> = { 1: 'tierCake', 2: 'tierWarm' };
type NewSort = 'recent' | 'oldest' | 'az';
type MessagesView = 'cards' | 'table';

const REPLY_OPTIONS = ['', 'Interested', 'Yes', 'Referred', 'Opportunity', 'Dead lead', 'Not interested', 'Blocked', 'Gone cold'];

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
  campaign?: { company: string; status: string };
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

  // Connections tab filters
  const [search, setSearch] = useState('');
  const [filterList, setFilterList] = useState('');
  const [filterFunction, setFilterFunction] = useState('');
  const [filterReply, setFilterReply] = useState('');

  const [messagesView, setMessagesView] = useState<MessagesView>('cards');
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
  const [newCompanyName, setNewCompanyName] = useState('');
  const [commentDrafts, setCommentDrafts] = useState<Record<number, string>>({});

  // Message picker on contact card
  const [selectedMessage, setSelectedMessage] = useState('');

  // All tab inline edit
  const [editingRowIndex, setEditingRowIndex] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [saveLoading, setSaveLoading] = useState(false);

  const [copied, setCopied] = useState(false);
  const [copiedMsg, setCopiedMsg] = useState<string | null>(null);
  const [copiedCake, setCopiedCake] = useState(false);
  const cakeCopyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const msgCopyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
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
    if (seededExpand.current || !data?.today || data.today.length === 0) return;
    seededExpand.current = true;
    setExpandedCompanies(new Set([data.today[0].company]));
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
        // Secondary: user-chosen sort
        if (newSort === 'az') return a.company.localeCompare(b.company);
        const da = parseDate(a.connectedOn);
        const db = parseDate(b.connectedOn);
        if (!da || !db) return a.company.localeCompare(b.company);
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

  const suggestion: SuggestedMessage | null =
    contact && data
      ? suggestMessage(contact, data.allContacts, data.messages, tab === 'followup')
      : null;

  const followUpStage = tab !== 'followup' ? 0
    : !contact?.followUpMessage1 ? 1
    : !contact?.followUpMessage2 ? 2
    : 3;

  const messageOptions = data?.messages.filter(m =>
    tab === 'new'
      ? m.messageType === 'Initial Outreach'
      : m.messageType === 'Follow Up'
  ) ?? [];

  const todayGroups: CompanyGroup[] = (data?.today ?? [])
    .map(g => ({ ...g, contacts: g.contacts.filter(c => !dismissed.has(c.rowIndex)) }))
    .filter(g => g.contacts.length > 0);
  const todayContactCount = todayGroups.reduce((n, g) => n + g.contacts.length, 0);

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

  async function updateCampaign(company: string, status: string) {
    const payload: UpdateBody = { campaign: { company, status } };
    const ok = await postUpdate(payload);
    if (!ok) setFailedWrites(prev => [...prev, payload]);
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

  function handleEmailContact(c: Contact) {
    if (!c.email) return;
    window.location.href = `mailto:${c.email}`;
  }

  async function handleTodayDone(c: Contact) {
    const cells: { col: string; value: string }[] = [{ col: 'N', value: todayDMY() }];
    let actionType: string;
    let newFollowUpCount: number | null = null;
    let messageField: 'message' | 'followUpMessage1' | 'followUpMessage2' | null = null;

    if (!c.message) {
      cells.push({ col: 'I', value: 'One-off' });
      messageField = 'message';
      actionType = 'new';
    } else {
      newFollowUpCount = (parseInt(c.followUps) || 0) + 1;
      cells.push({ col: 'K', value: String(newFollowUpCount) });
      if (!c.followUpMessage1) {
        cells.push({ col: 'L', value: 'One-off' });
        messageField = 'followUpMessage1';
        actionType = 'followup1';
      } else if (!c.followUpMessage2) {
        cells.push({ col: 'M', value: 'One-off' });
        messageField = 'followUpMessage2';
        actionType = 'followup2';
      } else {
        actionType = 'followup3';
      }
    }

    await updateSheet(c.rowIndex, cells, {
      action: actionType,
      template: 'One-off',
      name: c.fullName,
      company: c.company,
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

  async function handleReplied(c: Contact, value: 'Interested' | 'Not interested') {
    await updateSheet(c.rowIndex, [{ col: 'J', value }], {
      action: 'reply',
      detail: value,
      name: c.fullName,
      company: c.company,
    });
    setData(prev => {
      if (!prev) return prev;
      const upd = (x: Contact) => (x.rowIndex !== c.rowIndex ? x : { ...x, reply: value });
      return { ...prev, allContacts: prev.allContacts.map(upd) };
    });
    setDismissed(prev => new Set(prev).add(c.rowIndex));
    setActiveMenu(null);
    if (value === 'Interested') {
      setCelebration({ title: '\u{1F389} Interested!', detail: `${c.fullName} at ${c.company} is interested` });
    }
  }

  async function handleAddCompany() {
    const company = newCompanyName.trim();
    if (!company) return;
    setNewCompanyName('');
    setData(prev => {
      if (!prev) return prev;
      const existing = prev.campaigns.find(c => normAbbr(c.company) === normAbbr(company));
      const campaigns = existing
        ? prev.campaigns.map(c => (c === existing ? { ...c, status: 'Cake sent' } : c))
        : [...prev.campaigns, { company, status: 'Cake sent', cakeSentDate: '' }];
      return { ...prev, campaigns };
    });
    await updateCampaign(company, 'Cake sent');
  }

  async function handleRemoveCompany(company: string) {
    setData(prev => {
      if (!prev) return prev;
      return { ...prev, campaigns: prev.campaigns.map(c => (c.company === company ? { ...c, status: 'Closed' } : c)) };
    });
    await updateCampaign(company, 'Closed');
  }

  async function handleSaveComment(c: Contact) {
    const value = commentDrafts[c.rowIndex] ?? c.comment;
    await updateSheet(c.rowIndex, [{ col: 'O', value }]);
    setData(prev => {
      if (!prev) return prev;
      const upd = <T extends Contact>(x: T) => (x.rowIndex !== c.rowIndex ? x : { ...x, comment: value });
      return {
        ...prev,
        allContacts: prev.allContacts.map(upd),
        today: prev.today.map(g => ({ ...g, contacts: g.contacts.map(upd) })),
      };
    });
  }

  async function handleAction(action: 'contacted' | 'dead') {
    if (!contact || actionLoading) return;
    setActionLoading(true);

    const c = contact;
    const cells: { col: string; value: string }[] = [];

    if (action === 'contacted') {
      const templateUsed = selectedMessage || suggestion?.abbreviation || '';
      const actionType = tab === 'new' ? 'new' : `followup${followUpStage}`;

      if (templateUsed) {
        if (tab === 'new') cells.push({ col: 'I', value: templateUsed });
        else if (followUpStage === 1) cells.push({ col: 'L', value: templateUsed });
        else if (followUpStage === 2) cells.push({ col: 'M', value: templateUsed });
      }
      const newFollowUpCount = tab === 'followup' ? (parseInt(c.followUps) || 0) + 1 : null;
      if (newFollowUpCount !== null) cells.push({ col: 'K', value: String(newFollowUpCount) });
      cells.push({ col: 'N', value: todayDMY() });

      await updateSheet(c.rowIndex, cells, {
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
                ...(templateUsed && tab === 'followup' && followUpStage === 1 ? { followUpMessage1: templateUsed } : {}),
                ...(templateUsed && tab === 'followup' && followUpStage === 2 ? { followUpMessage2: templateUsed } : {}),
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
      cells.push({ col: 'J', value: 'Dead lead' });
      await updateSheet(c.rowIndex, cells, {
        action: 'reply',
        detail: 'Dead lead',
        name: c.fullName,
        company: c.company,
      });
    }

    setDismissed(prev => new Set(prev).add(c.rowIndex));
    const newQueue = queue.filter(q => q.rowIndex !== c.rowIndex);
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
    setCombo(0);
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
    if (editingRowIndex === null || saveLoading || !data) return;
    setSaveLoading(true);

    const fieldCols: Record<string, string> = {
      list: 'F', function: 'G', message: 'I', reply: 'J',
      followUpMessage1: 'L', followUpMessage2: 'M', lastContacted: 'N', comment: 'O',
    };

    const cells = Object.entries(editValues).map(([field, value]) => ({
      col: fieldCols[field],
      value,
    }));

    const prevContact = data.allContacts.find(c => c.rowIndex === editingRowIndex);
    const replyChanged = !!prevContact && editValues.reply !== prevContact.reply;
    const becameInterested =
      replyChanged &&
      editValues.reply.toLowerCase() === 'interested' &&
      prevContact!.reply.toLowerCase() !== 'interested';
    const creditedTemplate =
      editValues.followUpMessage2 || editValues.followUpMessage1 || editValues.message || '';

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
        followUpMessage1: editValues.followUpMessage1,
        followUpMessage2: editValues.followUpMessage2,
        lastContacted: editValues.lastContacted,
        comment: editValues.comment,
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
          <button className={`${styles.tab} ${tab === 'today' ? styles.tabActive : ''}`} onClick={() => handleTabSwitch('today')}>
            Today
            <span className={styles.tabCount}>{todayContactCount}</span>
          </button>
          <button className={`${styles.tab} ${tab === 'messages' ? styles.tabActive : ''}`} onClick={() => handleTabSwitch('messages')}>
            Messages
          </button>
          <button className={`${styles.tab} ${tab === 'cake' ? styles.tabActive : ''}`} onClick={() => handleTabSwitch('cake')}>
            Cake
          </button>
          <button className={`${styles.tab} ${tab === 'connections' ? styles.tabActive : ''}`} onClick={() => handleTabSwitch('connections')}>
            All
            <span className={styles.tabCount}>{data ? data.allContacts.length : 0}</span>
          </button>
          <button className={`${styles.tab} ${tab === 'stats' ? styles.tabActive : ''}`} onClick={() => handleTabSwitch('stats')}>
            Stats
          </button>
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
          <div className={styles.cakePage}>
            <div className={styles.cakeCard}>
              <div className={styles.cakeCardTitle}>ChatGPT prompt</div>
              <p className={styles.cakePromptText}>
                {`I'm generating images of cakes for marketing outreach campaigns. Replace the cake topper image with a photo image of the brand provided. Content of the photo image are: Brand logo top and centre. Then the marketing headline central to the cake. Then client logo's (if any provided) underneath - if no client logos provided then do not make these up. Then bottom left is a placeholder QR code. Bottom right is placeholder contact details (email, phone, website). Cake top background should reflect that of the brand image provided, ensuring the photo is not a completely flat colour - it needs to look like a photo printed on a cake topper, not a badly photoshopped image stuck on.`}
              </p>
              <button
                className={`${styles.copyBtn} ${copiedCake ? styles.copyBtnDone : ''}`}
                onClick={() => {
                  const prompt = `I'm generating images of cakes for marketing outreach campaigns. Replace the cake topper image with a photo image of the brand provided. Content of the photo image are: Brand logo top and centre. Then the marketing headline central to the cake. Then client logo's (if any provided) underneath - if no client logos provided then do not make these up. Then bottom left is a placeholder QR code. Bottom right is placeholder contact details (email, phone, website). Cake top background should reflect that of the brand image provided, ensuring the photo is not a completely flat colour - it needs to look like a photo printed on a cake topper, not a badly photoshopped image stuck on.`;
                  navigator.clipboard.writeText(prompt).then(() => {
                    setCopiedCake(true);
                    if (cakeCopyTimeout.current) clearTimeout(cakeCopyTimeout.current);
                    cakeCopyTimeout.current = setTimeout(() => setCopiedCake(false), 2000);
                  });
                }}
              >
                {copiedCake ? (
                  <><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Copied</>
                ) : (
                  <><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy prompt</>
                )}
              </button>
            </div>

            <div className={styles.cakeCard}>
              <div className={styles.cakeCardTitle}>Cake topper template</div>
              <p className={styles.cakeHint}>Upload this image alongside the prompt and a screenshot of the contact's website into ChatGPT.</p>
              <a
                className={styles.cakeTemplateBtn}
                href="https://drive.google.com/file/d/1ABzTiKcqTw8UfkEVXvFt7-yM1zxxY81K/view?usp=sharing"
                target="_blank"
                rel="noopener noreferrer"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Open template in Drive
              </a>
            </div>
          </div>
        )

        /* ── STATS TAB ── */
        : tab === 'stats' ? (() => {
          if (!stats) return null;

          const { todayCount, todayNew: tNew, todayFollowUps: tFu, streak, thisWeek, lastWeek, sixWeeks, replyRates } = stats;
          const maxBar = Math.max(...sixWeeks.map(w => w.total), 1);

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
        })()

        /* ── ALL CONTACTS TAB ── */
        : tab === 'connections' ? (() => {
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

        /* ── TODAY TAB ── */
        : tab === 'today' ? (() => {
          const tierCounts: Record<Tier, number> = { 1: 0, 2: 0 };
          todayGroups.forEach(g => g.contacts.forEach(c => { tierCounts[c.tier]++; }));
          const visibleGroups = tierFilter
            ? todayGroups.filter(g => g.contacts.some(c => c.tier === tierFilter))
            : todayGroups;
          const watchedCompanies = (data?.campaigns ?? []).filter(c => !isCampaignClosed(c.status));

          return (
            <div className={styles.todayPage}>
              <div className={styles.tierChipsRow}>
                {([1, 2] as Tier[]).map(t => (
                  <button
                    key={t}
                    className={`${styles.tierChip} ${styles[TIER_STYLE[t]]} ${tierFilter === t ? styles.tierChipActive : ''}`}
                    onClick={() => setTierFilter(f => (f === t ? null : t))}
                  >
                    {TIER_ICONS[t]} {tierCounts[t]}
                  </button>
                ))}
                <button className={styles.manageBtn} onClick={() => setManageOpen(o => !o)}>
                  {manageOpen ? 'Close' : 'Manage companies'}
                </button>
              </div>

              {manageOpen && (
                <div className={styles.managePanel}>
                  <div className={styles.manageAddRow}>
                    <input
                      className={styles.manageInput}
                      placeholder="Company name"
                      value={newCompanyName}
                      onChange={e => setNewCompanyName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleAddCompany()}
                    />
                    <button className={styles.manageAddBtn} onClick={handleAddCompany}>Add</button>
                  </div>
                  <div className={styles.manageChips}>
                    {watchedCompanies.map(c => (
                      <span key={c.company} className={styles.manageChip}>
                        {c.company}
                        <button onClick={() => handleRemoveCompany(c.company)} aria-label={`Stop watching ${c.company}`}>&times;</button>
                      </span>
                    ))}
                    {watchedCompanies.length === 0 && <span className={styles.manageEmpty}>No companies watched yet</span>}
                  </div>
                </div>
              )}

              {todayGroups.length === 0 ? (
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
                    <div
                      className={styles.companyHeader}
                      onClick={() => setExpandedCompanies(prev => {
                        const next = new Set(prev);
                        if (next.has(g.company)) next.delete(g.company); else next.add(g.company);
                        return next;
                      })}
                    >
                      <span className={styles.companyName}>{g.company}</span>
                      <span className={`${styles.companyTierBadge} ${styles[TIER_STYLE[g.tier]]}`}>
                        {TIER_ICONS[g.tier]} {TIER_LABELS[g.tier]}
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
                                    {c.url && <i className={styles.channelDot} title="LinkedIn" />}
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

                              {menu === 'snooze' ? (
                                <div className={styles.todayMenuRow}>
                                  <button className={styles.todayMenuBtn} onClick={() => handleSnooze(c, 1)}>1 day</button>
                                  <button className={styles.todayMenuBtn} onClick={() => handleSnooze(c, 3)}>3 days</button>
                                  <button className={styles.todayMenuBtn} onClick={() => handleSnooze(c, 7)}>1 week</button>
                                  <button className={styles.todayMenuBtn} onClick={() => setActiveMenu(null)}>Cancel</button>
                                </div>
                              ) : menu === 'replied' ? (
                                <div className={styles.todayMenuRow}>
                                  <button className={`${styles.todayMenuBtn} ${styles.todayMenuGreen}`} onClick={() => handleReplied(c, 'Interested')}>Interested</button>
                                  <button className={`${styles.todayMenuBtn} ${styles.todayMenuRed}`} onClick={() => handleReplied(c, 'Not interested')}>Not interested</button>
                                  <button className={styles.todayMenuBtn} onClick={() => setActiveMenu(null)}>Cancel</button>
                                </div>
                              ) : (
                                <div className={styles.todayActionsRow}>
                                  <button className={`${styles.todayActionBtn} ${styles.todayActionGreen}`} onClick={() => handleTodayDone(c)}>
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                                    Done
                                  </button>
                                  <button className={styles.todayActionBtn} onClick={() => setActiveMenu({ rowIndex: c.rowIndex, type: 'snooze' })}>Snooze</button>
                                  <button className={styles.todayActionBtn} onClick={() => setActiveMenu({ rowIndex: c.rowIndex, type: 'replied' })}>Replied</button>
                                  {c.url ? (
                                    <button className={styles.todayChannelBtn} onClick={() => handleLinkedIn(c)} aria-label="Open LinkedIn">
                                      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                                    </button>
                                  ) : c.email ? (
                                    <button className={styles.todayChannelBtn} onClick={() => handleEmailContact(c)} aria-label="Email">
                                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/></svg>
                                    </button>
                                  ) : null}
                                </div>
                              )}

                              <div className={styles.todayCommentRow}>
                                <input
                                  className={styles.todayCommentInput}
                                  placeholder="Add a comment…"
                                  value={commentDrafts[c.rowIndex] ?? c.comment}
                                  onChange={e => setCommentDrafts(prev => ({ ...prev, [c.rowIndex]: e.target.value }))}
                                  onKeyDown={e => e.key === 'Enter' && handleSaveComment(c)}
                                />
                                {(commentDrafts[c.rowIndex] ?? c.comment) !== c.comment && (
                                  <button className={styles.todayCommentSaveBtn} onClick={() => handleSaveComment(c)}>Save</button>
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
            {followUpStage <= 2 && messageOptions.length > 0 && (
              <div className={styles.msgPickerRow}>
                <label className={styles.msgPickerLabel}>
                  {followUpStage === 2 ? 'Follow up 2' : followUpStage === 1 ? 'Follow up 1' : 'Message sent'}
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
            {followUpStage === 3 && (
              <div className={styles.secondFollowUpNote}>3rd follow-up — date only will be recorded</div>
            )}

            {/* Actions */}
            <div className={styles.actionRow}>
              <button
                className={`${styles.actionBtn} ${styles.contactedBtn}`}
                onClick={() => handleAction('contacted')}
                disabled={actionLoading}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                Sent
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
    </div>
  );
}
