// Conversations: every lead's back-and-forth in one place. Log replies you received, let the AI suggest an
// answer (a DRAFT for approval — never sent automatically), and see WhatsApp messages from your business number.
// All lead text is rendered as plain text (React escapes it).
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../../lib/api.js';
import useDocumentTitle from '../../../hooks/useDocumentTitle.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import { useToast } from '../../../components/Toast.jsx';
import { PageHeader, Card, Badge, Button, Field, SelectField, TextArea, Alert, LoadingState, ErrorState, EmptyState, Pager, Modal } from '../../../components/ui.jsx';
import MessageCard from '../../../components/messages/MessageCard.jsx';
import { apiErrorMessage } from '../../../utils/apiErrors.js';
import { formatDateTime } from '../../../utils/platform.js';
import { CHANNEL_LABEL, CHANNEL_LIMITS, CHANNELS, INTENT_LABEL, INTENT_COLOR, CONVERSATION_STATUS_LABEL, CONVERSATION_STATUS_COLOR } from '../../../utils/messageOptions.js';

const TABS = [['', 'All'], ['ACTIVE', 'Needs reply'], ['WAITING', 'Waiting'], ['unmatched', 'Unknown numbers'], ['CLOSED', 'Closed']];
const SOURCE_LABEL = { MANUAL_LOG: 'logged by hand', OUTREACH: 'sent from LeadFlow', WHATSAPP_WEBHOOK: 'WhatsApp', WHATSAPP_API: 'WhatsApp API' };
const OPEN_DRAFT = ['PENDING_REVIEW', 'GENERATING', 'APPROVED', 'SEND_FAILED'];

const titleOf = (c) => c.leadId?.name || c.contactName || c.externalThreadId || 'Unknown';

function ConversationList({ selected, onSelect, leadFilter }) {
  const { can } = useAuth();
  const [tab, setTab] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const params = { page, limit: 20, ...(leadFilter && { leadId: leadFilter }), ...(q.trim() && { q: q.trim() }), ...(tab === 'unmatched' ? { unmatched: 'true' } : tab ? { status: tab } : {}) };
  const list = useQuery({
    queryKey: ['conversations', 'list', params],
    queryFn: async () => (await api.get('/conversations', { params })).data.data,
    placeholderData: keepPreviousData,
    refetchInterval: 30_000, // new WhatsApp messages show up without reloading
  });
  const tabs = TABS.filter(([k]) => k !== 'unmatched' || can('leads:read:all'));
  return (
    <Card>
      <div className="mb-3 flex flex-wrap gap-1" role="tablist">
        {tabs.map(([k, l]) => (
          <button key={k || 'all'} type="button" role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setPage(1); }} className={`rounded-lg px-2.5 py-1.5 text-xs ${tab === k ? 'bg-brand-500/15 text-brand-500' : 'text-white/60 hover:bg-white/5'}`}>{l}</button>
        ))}
      </div>
      {!leadFilter && <Field label="Search" name="q" placeholder="Lead or contact name" value={q} maxLength={80} onChange={(e) => { setQ(e.target.value); setPage(1); }} />}
      {list.isLoading && <LoadingState rows={4} />}
      {list.isError && <ErrorState message={apiErrorMessage(list.error)} onRetry={list.refetch} />}
      {list.data?.items.length === 0 && <EmptyState icon="chat" title="No conversations" description="Sent messages and logged replies appear here." />}
      <ul className="mt-3 divide-y divide-white/5">
        {list.data?.items.map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => onSelect(c.id)} className={`w-full rounded-lg px-2 py-2.5 text-left hover:bg-white/5 ${selected === c.id ? 'bg-white/5 ring-1 ring-brand-500/40' : ''}`}>
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{titleOf(c)}</span>
                {c.unread > 0 && <span className="rounded-full bg-brand-500 px-1.5 text-[10px] font-semibold text-ink-950">{c.unread}</span>}
                <span className="ml-auto shrink-0 text-[11px] text-white/35">{c.lastMessageAt ? formatDateTime(c.lastMessageAt) : ''}</span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-xs text-white/45">
                <span>{CHANNEL_LABEL[c.channel]}</span>
                <Badge color={CONVERSATION_STATUS_COLOR[c.status]}>{CONVERSATION_STATUS_LABEL[c.status]}</Badge>
                {!c.leadId && <Badge color="amber">no lead</Badge>}
                {c.lastIntent && <Badge color={INTENT_COLOR[c.lastIntent]}>{INTENT_LABEL[c.lastIntent]}</Badge>}
              </div>
              {c.lastSnippet && <p className="mt-1 truncate text-xs text-white/55">{c.lastDirection === 'OUTBOUND' ? 'You: ' : ''}{c.lastSnippet}</p>}
            </button>
          </li>
        ))}
      </ul>
      <Pager pagination={list.data?.pagination} onPage={setPage} />
    </Card>
  );
}

function Bubble({ m }) {
  const inbound = m.direction === 'INBOUND';
  return (
    <div className={`flex ${inbound ? 'justify-start' : 'justify-end'}`}>
      <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${inbound ? 'rounded-bl-sm bg-white/[0.06]' : 'rounded-br-sm bg-brand-500/15'}`}>
        {m.suspectedInjection && <p className="mb-1 text-[11px] text-amber-300">⚠ Contains instructions aimed at an AI — the assistant treats it as text only.</p>}
        <p className="whitespace-pre-wrap break-words text-white/90">{m.body}</p>
        <p className="mt-1 text-right text-[10px] text-white/35">
          {formatDateTime(m.at)} · {SOURCE_LABEL[m.source]}{m.userId?.name ? ` · ${m.userId.name}` : ''}{m.deliveryStatus ? ` · ${m.deliveryStatus}` : ''}
          {m.aiIntent && <> · {INTENT_LABEL[m.aiIntent]}</>}
        </p>
      </div>
    </div>
  );
}

function LinkPanel({ conv, onDone }) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [name, setName] = useState(conv.contactName || '');
  const leads = useQuery({
    queryKey: ['leads', 'pick', search],
    queryFn: async () => (await api.get('/leads', { params: { search, limit: 8 } })).data.data.items,
    enabled: search.trim().length >= 2,
  });
  const link = useMutation({ mutationFn: (leadId) => api.post(`/conversations/${conv.id}/link`, { leadId }), onSuccess: () => { toast.success('Linked to the lead'); onDone(); } });
  const create = useMutation({ mutationFn: () => api.post(`/conversations/${conv.id}/create-lead`, name.trim() ? { name: name.trim() } : {}), onSuccess: () => { toast.success('Lead created'); onDone(); } });
  const err = link.error || create.error;
  return (
    <div className="rounded-xl bg-amber-400/5 p-3 ring-1 ring-amber-400/20">
      <p className="text-sm">This number ({conv.externalThreadId}) is not a lead yet. Link it to an existing lead, or create a new one.</p>
      {err && <div className="mt-2"><Alert>{apiErrorMessage(err)}</Alert></div>}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <Field label="Find a lead" name="leadSearch" placeholder="Name, phone…" value={search} maxLength={80} onChange={(e) => setSearch(e.target.value)} />
          <ul className="mt-1 space-y-1">
            {leads.data?.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate">{l.name}{l.phone ? <span className="text-white/40"> · {l.phone}</span> : null}</span>
                <Button variant="ghost" className="px-2 py-1 text-xs" loading={link.isPending} onClick={() => link.mutate(l.id)}>Link</Button>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <Field label="New lead name" name="newLeadName" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          <Button className="mt-2" loading={create.isPending} onClick={() => create.mutate()}>Create lead</Button>
        </div>
      </div>
    </div>
  );
}

function ReplyTools({ conv, lead, canWrite }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [log, setLog] = useState({ direction: 'INBOUND', body: '', at: '' });
  const [ask, setAsk] = useState(null); // null | 'ai' | 'manual'
  const [instructions, setInstructions] = useState('');
  const [draft, setDraft] = useState({ subject: '', body: '' });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['conversations'] });
    queryClient.invalidateQueries({ queryKey: ['messages'] });
    queryClient.invalidateQueries({ queryKey: ['leads'] });
  };
  const logMsg = useMutation({
    mutationFn: async () => (await api.post(`/conversations/${conv.id}/messages`, { direction: log.direction, body: log.body, ...(log.at && { at: new Date(log.at).toISOString() }) })).data.data,
    onSuccess: (d) => {
      toast.success(log.direction === 'INBOUND' ? 'Reply saved — lead marked as replied' : 'Saved');
      if (d.suspectedInjection) toast.error('Careful: this text contains instructions aimed at an AI.');
      setLog({ direction: 'INBOUND', body: '', at: '' });
      refresh();
    },
  });
  const suggest = useMutation({
    mutationFn: async () => (await api.post(`/conversations/${conv.id}/suggest-reply`, instructions.trim() ? { instructions: instructions.trim() } : {})).data.data.message,
    onSuccess: () => { toast.success('Suggestion ready — review it below'); setAsk(null); setInstructions(''); refresh(); },
  });
  const manual = useMutation({
    mutationFn: async () => (await api.post(`/conversations/${conv.id}/draft-reply`, { body: draft.body, ...(conv.channel === 'EMAIL' && draft.subject && { subject: draft.subject }) })).data.data.message,
    onSuccess: () => { toast.success('Draft created — it waits for approval'); setAsk(null); setDraft({ subject: '', body: '' }); refresh(); },
  });
  const lastInbound = conv.lastDirection === 'INBOUND';

  if (!canWrite) return null;
  return (
    <div className="space-y-3">
      {lead?.doNotContact ? (
        <Alert>This lead is on your do-not-contact list — no replies can be prepared.</Alert>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button disabled={!lastInbound} title={lastInbound ? '' : 'Needs a message from the lead first'} onClick={() => { suggest.reset(); setAsk('ai'); }}>✨ Suggest reply (AI)</Button>
          <Button variant="ghost" onClick={() => { manual.reset(); setAsk('manual'); }}>Write reply</Button>
          {!lastInbound && <span className="self-center text-xs text-white/40">AI suggestions need a message from the lead — log their reply below.</span>}
        </div>
      )}

      <form
        className="space-y-2 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/10"
        onSubmit={(e) => { e.preventDefault(); if (log.body.trim()) logMsg.mutate(); }}
      >
        <p className="text-xs font-medium text-white/60">Log a message (e.g. a reply you got by email or on your phone)</p>
        {logMsg.isError && <Alert>{apiErrorMessage(logMsg.error)}</Alert>}
        <div className="grid gap-2 sm:grid-cols-2">
          <SelectField name="direction" aria-label="Direction" value={log.direction} onChange={(e) => setLog({ ...log, direction: e.target.value })} options={[{ value: 'INBOUND', label: 'They wrote' }, { value: 'OUTBOUND', label: 'I sent it outside LeadFlow' }]} />
          <Field name="at" aria-label="When" type="datetime-local" value={log.at} max={new Date().toISOString().slice(0, 16)} onChange={(e) => setLog({ ...log, at: e.target.value })} hint="Leave empty = now" />
        </div>
        <TextArea name="logBody" aria-label="Message text" rows={3} maxLength={5000} value={log.body} onChange={(e) => setLog({ ...log, body: e.target.value })} placeholder="Paste the message exactly as written" />
        <Button type="submit" variant="ghost" loading={logMsg.isPending} disabled={!log.body.trim()}>Save to conversation</Button>
      </form>

      <Modal
        open={ask === 'ai'}
        onClose={() => setAsk(null)}
        title="Suggest a reply"
        footer={<><Button variant="ghost" onClick={() => setAsk(null)}>Cancel</Button><Button loading={suggest.isPending} onClick={() => suggest.mutate()}>Suggest reply</Button></>}
      >
        <div className="space-y-3">
          {suggest.isError && <Alert>{apiErrorMessage(suggest.error)}</Alert>}
          <TextArea label="Anything the reply should say? (optional)" name="instructions" rows={3} maxLength={500} value={instructions} onChange={(e) => setInstructions(e.target.value)} hint="e.g. our 5-page website starts at Rs 60,000 — offer a call. Prices/dates are only used if YOU write them here, and then need extra confirmation." />
          <p className="text-xs text-white/40">The AI reads the last 20 messages as data (it never follows instructions written by the lead). You get a draft to approve — nothing is sent. Costs 1 AI request.</p>
        </div>
      </Modal>
      <Modal
        open={ask === 'manual'}
        onClose={() => setAsk(null)}
        title="Write a reply"
        footer={<><Button variant="ghost" onClick={() => setAsk(null)}>Cancel</Button><Button loading={manual.isPending} disabled={!draft.body.trim()} onClick={() => manual.mutate()}>Create draft</Button></>}
      >
        <div className="space-y-3">
          {manual.isError && <Alert>{apiErrorMessage(manual.error)}</Alert>}
          {conv.channel === 'EMAIL' && <Field label="Subject" name="subject" maxLength={150} value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />}
          <TextArea label="Reply" name="draftBody" rows={7} maxLength={CHANNEL_LIMITS[conv.channel]} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
        </div>
      </Modal>
    </div>
  );
}

function Thread({ id }) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const canWrite = can('leads:write');
  const q = useQuery({ queryKey: ['conversations', 'one', id], queryFn: async () => (await api.get(`/conversations/${id}`)).data.data, refetchInterval: 30_000 });
  const conv = q.data?.conversation;
  const leadId = conv?.leadId?.id;
  const drafts = useQuery({
    queryKey: ['messages', 'conversation', leadId, conv?.channel],
    queryFn: async () => (await api.get('/messages', { params: { leadId, channel: conv.channel, limit: 20 } })).data.data.items,
    enabled: Boolean(leadId),
  });
  const read = useMutation({ mutationFn: () => api.post(`/conversations/${id}/read`), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['conversations', 'list'] }) });
  const status = useMutation({
    mutationFn: (s) => api.patch(`/conversations/${id}/status`, { status: s }),
    onSuccess: () => { toast.success('Updated'); queryClient.invalidateQueries({ queryKey: ['conversations'] }); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const unread = conv?.unread || 0;
  useEffect(() => {
    if (unread > 0 && !read.isPending) read.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, unread]);

  if (q.isLoading) return <Card><LoadingState rows={6} /></Card>;
  if (q.isError) return <Card><ErrorState message={apiErrorMessage(q.error)} onRetry={q.refetch} /></Card>;
  const open = (drafts.data || []).filter((m) => OPEN_DRAFT.includes(m.status));
  const wa = conv.whatsappWindow;

  return (
    <Card>
      <header className="flex flex-wrap items-center gap-2 border-b border-white/5 pb-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">{conv.leadId ? <Link className="hover:underline" to={`/app/leads/${conv.leadId.id}`}>{conv.leadId.name}</Link> : titleOf(conv)}</h2>
          <p className="text-xs text-white/45">
            {CHANNEL_LABEL[conv.channel]}{conv.externalThreadId ? ` · ${conv.externalThreadId}` : ''}{conv.contactName && conv.leadId ? ` · WhatsApp name: ${conv.contactName}` : ''}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {wa && (wa.open ? <Badge color="green">WhatsApp window open until {formatDateTime(wa.closesAt)}</Badge> : conv.externalThreadId ? <Badge color="gray">WhatsApp window closed</Badge> : null)}
          {canWrite ? (
            <SelectField name="convStatus" aria-label="Conversation status" value={conv.status} onChange={(e) => status.mutate(e.target.value)} options={Object.entries(CONVERSATION_STATUS_LABEL).map(([value, label]) => ({ value, label }))} />
          ) : (
            <Badge color={CONVERSATION_STATUS_COLOR[conv.status]}>{CONVERSATION_STATUS_LABEL[conv.status]}</Badge>
          )}
        </div>
      </header>

      {!conv.leadId && canWrite && can('leads:read:all') && <div className="mt-3"><LinkPanel conv={conv} onDone={() => queryClient.invalidateQueries({ queryKey: ['conversations'] })} /></div>}

      <div className="mt-4 max-h-[55vh] space-y-2.5 overflow-y-auto pr-1">
        {q.data.truncated && <p className="text-center text-xs text-white/35">Showing the latest 200 messages.</p>}
        {q.data.messages.length === 0 && <p className="py-6 text-center text-sm text-white/40">No messages yet.</p>}
        {q.data.messages.map((m) => <Bubble key={m.id} m={m} />)}
      </div>

      {conv.leadId && (
        <div className="mt-4 space-y-3 border-t border-white/5 pt-4">
          <ReplyTools conv={conv} lead={conv.leadId} canWrite={canWrite} />
          {open.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-medium text-white/60">Drafts for this conversation (approve → send from Outreach or here)</p>
              {open.map((m) => <MessageCard key={m.id} message={m} showLead={false} />)}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function StartConversation({ leadId, onStarted }) {
  const [channel, setChannel] = useState('WHATSAPP');
  const start = useMutation({ mutationFn: async () => (await api.post('/conversations', { leadId, channel })).data.data.conversation, onSuccess: (c) => onStarted(c.id) });
  return (
    <div className="flex flex-wrap items-end gap-2">
      <SelectField label="Start a conversation on" name="startChannel" value={channel} onChange={(e) => setChannel(e.target.value)} options={CHANNELS.map(([value, label]) => ({ value, label }))} />
      <Button variant="ghost" loading={start.isPending} onClick={() => start.mutate()}>Open</Button>
      {start.isError && <span className="text-xs text-red-300">{apiErrorMessage(start.error)}</span>}
    </div>
  );
}

export default function ConversationsPage() {
  useDocumentTitle('Conversations');
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const selected = params.get('open');
  const leadFilter = params.get('lead');
  const select = (id) => setParams((p) => { const n = new URLSearchParams(p); if (id) n.set('open', id); else n.delete('open'); return n; });

  return (
    <>
      <PageHeader
        title="Conversations"
        description="Every reply in one place. The AI can suggest answers — you approve every message before it goes out."
        actions={leadFilter && <Link to="/app/conversations" className="rounded-lg px-3 py-2 text-sm text-white/70 ring-1 ring-white/15 hover:bg-white/5">Show all leads</Link>}
      />
      {leadFilter && can('leads:write') && (
        <div className="mb-4"><StartConversation leadId={leadFilter} onStarted={(id) => { queryClient.invalidateQueries({ queryKey: ['conversations'] }); select(id); }} /></div>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <ConversationList selected={selected} onSelect={select} leadFilter={leadFilter} />
        {selected ? <Thread key={selected} id={selected} /> : (
          <Card><EmptyState icon="chat" title="Choose a conversation" description="WhatsApp messages to your business number arrive here automatically once WhatsApp Cloud API is connected (Settings → Integrations)." /></Card>
        )}
      </div>
    </>
  );
}
