// Link da call: o que o Closer colou vale; sem ele, o link do Google Meet que a agenda gerou. Renderização no servidor, sem navegador nem backend.
import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createComponentLoader } from './helpers/meta-component-harness.mjs'

const GOOGLE = 'https://meet.google.com/ant-qihv-cxe', MANUAL = 'https://meet.google.com/abc-defg-hij'
let statuses = new Map()
const h = React.createElement
const pass = ({ children }) => children
const ui = {
  '@/components/ui/button': { Button: ({ asChild, children, ...rest }) => asChild ? children : h('button', rest, children) },
  '@/components/ui/input': { Input: props => h('input', props) },
  '@/components/ui/label': { Label: props => h('label', props) },
  '@/components/ui/textarea': { Textarea: props => h('textarea', props) },
  '@/components/ui/badge': { Badge: pass },
  '@/components/ui/dialog': { Dialog: pass, DialogContent: pass, DialogDescription: pass, DialogFooter: pass, DialogHeader: pass, DialogTitle: pass },
  '@/hooks/useGoogleCalendar': { useGoogleCalendarStatuses: () => ({ statuses, loading: false, error: null }) },
  '@/hooks/useRoles': { useRoles: () => ({ capabilities: { executive: false } }) },
  'react-router-dom': { Link: ({ children }) => h('a', null, children) },
  '@/lib/arena-api': { arenaRpc: async () => undefined },
  '@/lib/sync': { refreshDashboardMutation: async () => undefined },
  '@/integrations/supabase/client': { supabase: {} },
  '@tanstack/react-query': { useQueryClient: () => ({}) },
}
const load = createComponentLoader(ui)
const meeting = load('src/lib/crm-call-meeting.ts')
const { CRMCallMeetButton } = load('src/components/crm/CRMCallMeetButton.tsx')
const { CalendarStatusesProvider } = load('src/components/crm/CRMCalendarStatus.tsx')
const { AgendaMeetingLink } = load('src/components/agenda/AgendaCallTools.tsx')

const status = (callId, over = {}) => statuses.set(callId, { callId, desiredRevision: '3', confirmedRevision: '3', status: 'synced', errorCode: null, lastSyncedAt: null, meetingUrl: GOOGLE, ...over })
// call de 10 min que começou há 1 min (dentro do horário), ou fora dele
const call = (over = {}) => ({ id: 'c1', scheduled_at: new Date(Date.now() - 60_000).toISOString(), duration_minutes: 10, is_completed: false, cancelled_at: null, outcome: null, meeting_link: null, ...over })
const inProvider = node => renderToStaticMarkup(h(CalendarStatusesProvider, { callIds: ['c1'] }, node))
const button = (c, over) => { statuses = new Map(); if (over !== null) status(c.id, over); return inProvider(h(CRMCallMeetButton, { call: c })) }
const field = (c, editavel, over) => { statuses = new Map(); if (over !== null) status(c.id, over); return inProvider(h(AgendaMeetingLink, { call: c, editavel })) }
const hrefOf = html => html.match(/href="([^"]+)"/)?.[1] ?? null

test('linkDaCall: o link do Closer vale; sem ele, o do Google; vazio ou em branco conta como sem link', () => {
  assert.equal(meeting.linkDaCall({ meeting_link: MANUAL }, GOOGLE), MANUAL)
  assert.equal(meeting.linkDaCall({ meeting_link: null }, GOOGLE), GOOGLE)
  assert.equal(meeting.linkDaCall({ meeting_link: '' }, GOOGLE), GOOGLE)
  assert.equal(meeting.linkDaCall({ meeting_link: '   ' }, GOOGLE), GOOGLE)
  assert.equal(meeting.linkDaCall({ meeting_link: ' ' + MANUAL + ' ' }, GOOGLE), MANUAL)
  assert.equal(meeting.linkDaCall({ meeting_link: null }, null), null)
  assert.equal(meeting.linkDaCall({ meeting_link: null }), null)
  assert.equal(meeting.linkDaCall({ meeting_link: null }, '  '), null)
})

test('podeEntrarNaCall: o link do Google libera o botão, só dentro do horário e com a call aberta', () => {
  const agora = Date.parse('2026-10-23T12:30:00Z'), base = { scheduled_at: '2026-10-23T12:24:00Z', duration_minutes: 10, is_completed: false, cancelled_at: null, outcome: null, meeting_link: null }
  assert.equal(meeting.podeEntrarNaCall(base, agora, GOOGLE), true)
  assert.equal(meeting.podeEntrarNaCall(base, agora), false, 'sem nenhum link não entra')
  assert.equal(meeting.podeEntrarNaCall({ ...base, meeting_link: MANUAL }, agora), true, 'o link do Closer continua bastando')
  assert.equal(meeting.podeEntrarNaCall(base, Date.parse('2026-10-23T12:23:59Z'), GOOGLE), false, 'antes do início')
  assert.equal(meeting.podeEntrarNaCall(base, Date.parse('2026-10-23T12:34:00Z'), GOOGLE), false, 'no instante do fim')
  assert.equal(meeting.podeEntrarNaCall({ ...base, outcome: 'venda_perdida' }, agora, GOOGLE), false, 'encerrada')
  assert.equal(meeting.podeEntrarNaCall({ ...base, is_completed: true }, agora, GOOGLE), false)
  assert.equal(meeting.podeEntrarNaCall({ ...base, cancelled_at: '2026-10-23T12:00:00Z' }, agora, GOOGLE), false, 'cancelada')
})

test('botão "Entrar na call": sem link do Closer usa o do Google; com o do Closer, o dele', () => {
  const noGoogle = button(call())
  assert.equal(hrefOf(noGoogle), GOOGLE); assert.match(noGoogle, /Entrar na call \(Google Meet\)/)
  assert.equal(hrefOf(button(call({ meeting_link: MANUAL }))), MANUAL, 'o link colado pelo Closer não é trocado')
  assert.equal(hrefOf(button(call({ meeting_link: '' }))), GOOGLE, 'link vazio não esconde o do Google')
})

test('botão "Entrar na call": nada sem link, fora do horário, encerrada, ou com a call saindo da agenda', () => {
  assert.equal(button(call(), null), '', 'sem status do Google e sem link do Closer')
  assert.equal(button(call(), { meetingUrl: null }), '', 'Google ainda não gerou o Meet')
  assert.equal(button(call({ scheduled_at: new Date(Date.now() + 3_600_000).toISOString() })), '', 'ainda não começou')
  assert.equal(button(call({ scheduled_at: new Date(Date.now() - 3_600_000).toISOString() })), '', 'já acabou')
  assert.equal(button(call({ outcome: 'venda_concluida' })), '', 'encerrada')
  assert.equal(button(call(), { status: 'removed', confirmedRevision: '3' }), '', 'removida da agenda: o link do Google não vale mais')
  assert.equal(hrefOf(button(call(), { status: 'synced', confirmedRevision: '2' })), GOOGLE, 'alteração pendente: o evento e o link são os mesmos')
  assert.equal(button(call(), { status: 'removed', confirmedRevision: '2' }), '', 'remoção pendente')
  assert.equal(hrefOf(button(call({ meeting_link: MANUAL }), { status: 'removed' })), MANUAL, 'o link do Closer não depende do Google')
})

test('campo da agenda (Closer): já vem preenchido com o link do Google e avisa de onde veio', () => {
  const html = field(call(), true)
  assert.match(html, new RegExp(`value="${GOOGLE}"`))
  assert.match(html, /Link gerado pela agenda do Google/)
  assert.match(html, /<button[^>]*disabled=""[^>]*>Salvar link</, 'nada novo para salvar')
})

test('campo da agenda (Closer): o link que ele colou vale e o aviso do Google some', () => {
  const html = field(call({ meeting_link: MANUAL }), true)
  assert.match(html, new RegExp(`value="${MANUAL}"`)); assert.doesNotMatch(html, new RegExp(GOOGLE))
  assert.doesNotMatch(html, /Link gerado pela agenda do Google/)
  assert.match(html, /<button[^>]*disabled=""[^>]*>Salvar link</)
})

test('campo da agenda (Closer): sem nenhum link continua vazio, com o exemplo de endereço', () => {
  const html = field(call(), true, null)
  assert.match(html, /value=""/); assert.match(html, /placeholder="https:\/\/meet\.google\.com\/abc-defg-hij"/)
  assert.doesNotMatch(html, /Link gerado pela agenda do Google/)
})

test('campo da agenda (quem só vê): mostra o link que vale, ou que o Closer ainda não colocou', () => {
  assert.equal(hrefOf(field(call(), false)), GOOGLE)
  assert.equal(hrefOf(field(call({ meeting_link: MANUAL }), false)), MANUAL)
  assert.match(field(call(), false, null), /O Closer ainda não colocou o link da reunião/)
})
