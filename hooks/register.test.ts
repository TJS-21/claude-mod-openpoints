import { test, expect } from 'claude-code/testing'
import type { On } from 'claude-code'

const DIR = '/home/.claude/openpoints-daten'
const SETZEN = 'mcp__openpoints__punkte_setzen'
const HINZU = 'mcp__openpoints__punkte_hinzufuegen'
const ERLEDIGT = 'mcp__openpoints__punkte_erledigt'
const KLAEREN = 'mcp__openpoints__punkte_klaeren'
const UUID = '0a1b2c3d-1234-4abc-8def-0123456789ab'
const HEUTE = '2026-10-20'
const PANE = { plugin: 'openpoints', component: 'Pane', requestId: 'openpoints', props: { id: 'openpoints', title: 'Offene Punkte' } } as const

type Opts = { pullFehler?: boolean; pushFehler?: number; unveraendert?: boolean; modell?: string; punkte?: unknown[]; flaechen?: string[]; sitzung?: string; dir?: string; ohneKlon?: boolean; appSitzung?: string }

// Ersetzt Dateisystem, Git, Uhr, Oberflächen und Modell: nichts im Test erreicht die Platte, GitHub oder die API.
function attrappe(on: On, opts: Opts = {}) {
  const punkte = opts.punkte ?? [{ id: 'a', text: 'Alt', isDone: true, chat: `https://claude.ai/chat/${UUID}`, erstellt: '2026-10-01' }]
  const dir = opts.dir ?? DIR
  const dateien = new Map<string, string>(opts.ohneKlon === true ? [] : [[`${dir}/punkte/web.json`, JSON.stringify({ projekt: 'Web', punkte })]])
  // Jeder Aufruf eines Programms, vollständig, für Prüfungen von Klon, Autor und Ordnern.
  const aufrufe: string[][] = []
  const git: string[][] = []
  const geoeffnet: string[][] = []
  const modell: { system?: string; prompt: string; model: string }[] = []
  const panes: string[] = []
  const geschlossen: string[] = []
  const prompts: string[] = []
  const eingefuegt: string[] = []
  let aktiv = 0
  let maxAktiv = 0
  on('clock.now', async () => ({ value: Date.parse(`${HEUTE}T12:00:00Z`) }) as never)
  on('session.surfaces', async () => ({ value: opts.flaechen ?? ['desktop'] }) as never)
  on('session.id', async () => ({ value: opts.sitzung ?? 'sitzung-1' }) as never)
  // Zählt jede Nachricht, die in den Chat ginge.
  on('prompt.fill', async (_$, e) => {
    eingefuegt.push((e as { text: string }).text)
    return { isFilled: true } as never
  })
  on('prompt.submit', async (_$, e) => {
    prompts.push((e as { text: string }).text)
    return { text: (e as { text: string }).text } as never
  })
  on('process.run', async (_$, e) => {
    aufrufe.push([...e.argv])
    if (e.argv[0] === 'sh') return { value: { exitCode: 0, stdout: (e.argv[2] ?? '').includes('HOST_SESSION') ? (opts.appSitzung ?? '') : '/home', stderr: '' } } as never
    if (e.argv[0] === 'mkdir' || (e.argv[0] === 'git' && e.argv[1] === 'clone')) return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
    if (e.argv[0] === 'open') {
      geoeffnet.push([...e.argv])
      return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
    }
    // git -C <dir> [-c name] [-c email] <befehl> …: die Autor-Angaben können fehlen
    let ab = 3
    while (e.argv[ab] === '-c') ab += 2
    const args = e.argv.slice(ab)
    git.push(args)
    aktiv++
    maxAktiv = Math.max(maxAktiv, aktiv)
    for (let i = 0; i < 5; i++) await Promise.resolve()
    aktiv--
    let fehler = opts.pullFehler === true && args[0] === 'pull'
    if (args[0] === 'diff') fehler = opts.unveraendert !== true
    if (args[0] === 'push' && (opts.pushFehler ?? 0) > 0) {
      opts.pushFehler = (opts.pushFehler ?? 0) - 1
      fehler = true
    }
    return { value: { exitCode: fehler ? 1 : 0, stdout: '', stderr: '' } } as never
  })
  on('fs.exists', async (_$, e) => ({ value: !(opts.ohneKlon === true && (e as { path: string }).path.endsWith('/.git')) }) as never)
  on('fs.list', async () => ({ value: [...dateien.keys()].map(k => ({ name: k.split('/').pop() })) }) as never)
  on('fs.read', async (_$, e) => {
    const t = dateien.get(e.path)
    if (t === undefined) throw new Error('fehlt')
    return { value: t } as never
  })
  on('fs.write', async (_$, e) => {
    dateien.set(e.path, e.text)
    return { value: undefined } as never
  })
  on('model.complete', async (_$, e) => {
    modell.push({ system: e.system, prompt: e.prompt, model: e.model })
    return { value: { isAnswered: true, text: opts.modell ?? '{"neu":[],"erledigt":[]}', usage: {} } } as never
  })
  on('ui.close', async (_$, e) => {
    geschlossen.push(e.id)
    return { value: undefined } as never
  })
  on('ui.open', async (_$, e) => {
    panes.push(e.id)
    return { value: { isPlaced: true } } as never
  })
  const liste = (slug = 'web') => JSON.parse(dateien.get(`${dir}/punkte/${slug}.json`) ?? '{"punkte":[]}') as { projekt: string; punkte: Record<string, unknown>[] }
  return { dateien, git, aufrufe, geoeffnet, modell, panes, geschlossen, prompts, eingefuegt, liste, maxAktiv: () => maxAktiv }
}

// ---- Speichern ----

test('punkte_setzen übernimmt nur Adressen echter Claude-Chats als Chat-Link', async ($, on) => {
  const a = attrappe(on)
  await $.tool.call({
    tool: SETZEN, slug: 'web', projekt: 'Web',
    punkte: [{ id: 'a', text: 'Alt', chat: 'file:///etc/passwd' }, { id: 'b', text: 'Neu', chat: 'https://claude.ai.evil.example/chat/x' }],
  } as never)
  expect(a.liste().punkte[0]?.chat).toBe(`https://claude.ai/chat/${UUID}`)
  expect(a.liste().punkte[1]?.chat).toBeUndefined()
})

test('punkte_setzen speichert, behält Status und Chat-Link und committet nur die Listendatei', async ($, on) => {
  const a = attrappe(on)
  const r = await $.tool.call({
    tool: SETZEN, slug: 'web', projekt: 'Web',
    punkte: [{ id: 'a', text: 'Alt umbenannt' }, { id: 'b', text: 'Neu' }],
  } as never)
  expect(r.result).toBe('Liste „Web“ gespeichert: 1 offen, 1 erledigt.')
  expect(a.liste().punkte[0]).toEqual({ id: 'a', text: 'Alt umbenannt', isDone: true, chat: `https://claude.ai/chat/${UUID}`, erstellt: '2026-10-01', geaendert: HEUTE })
  expect(a.liste().punkte[1]).toEqual({ id: 'b', text: 'Neu', isDone: false, sitzung: 'sitzung-1', erstellt: HEUTE })
  const commit = a.git.find(g => g[0] === 'commit') ?? []
  expect(commit.slice(-2)).toEqual(['--', 'punkte/web.json'])
  expect(a.git.map(g => g[0])).toEqual(['pull', 'add', 'diff', 'commit', 'push'])
})

test('ein slug mit Pfadanteilen wird abgelehnt', async ($, on) => {
  const a = attrappe(on)
  const r = await $.tool.call({ tool: SETZEN, slug: '../.claude-plugin/plugin', projekt: 'X', punkte: [] } as never)
  expect(r.deny).toContain('Ungültiger slug')
  const r2 = await $.tool.call({ tool: HINZU, punkte: [{ slug: '../x', projekt: 'X', text: 'Y' }] } as never)
  expect(r2.deny).toContain('Ungültiger slug')
  expect(a.git).toEqual([])
})

test('bei einem Konflikt wird der Rebase abgebrochen und nichts geschrieben', async ($, on) => {
  const a = attrappe(on, { pullFehler: true })
  const r = await $.tool.call({ tool: SETZEN, slug: 'web', projekt: 'Web', punkte: [] } as never)
  expect(r.result).toBe('Liste „Web“: Abgleich mit GitHub fehlgeschlagen, zeige letzten Stand.')
  expect(a.git.map(g => g.slice(0, 2).join(' '))).toEqual(['pull --rebase', 'rebase --abort'])
  expect(a.git.some(g => g[0] === 'commit')).toBe(false)
})

test('gleichzeitige Aufrufe laufen nacheinander', async ($, on) => {
  const a = attrappe(on)
  await Promise.all([
    $.tool.call({ tool: SETZEN, slug: 'web', projekt: 'Web', punkte: [{ id: 'a', text: 'Eins' }] } as never),
    $.tool.call({ tool: SETZEN, slug: 'neu', projekt: 'Neu', punkte: [{ id: 'c', text: 'Zwei' }] } as never),
  ])
  expect(a.maxAktiv()).toBe(1)
  expect(a.git.filter(g => g[0] === 'commit').length).toBe(2)
})

test('ein abgelehnter Push wird nach erneutem Abgleich einmal wiederholt', async ($, on) => {
  const a = attrappe(on, { pushFehler: 1 })
  const r = await $.tool.call({ tool: SETZEN, slug: 'web', projekt: 'Web', punkte: [{ id: 'a', text: 'Eins' }] } as never)
  expect(r.result).toBe('Liste „Web“ gespeichert: 0 offen, 1 erledigt.')
  expect(a.git.map(g => g[0])).toEqual(['pull', 'add', 'diff', 'commit', 'push', 'pull', 'push'])
})

test('bleibt der Push abgelehnt, sagt die Mod das', async ($, on) => {
  attrappe(on, { pushFehler: 2 })
  const r = await $.tool.call({ tool: SETZEN, slug: 'web', projekt: 'Web', punkte: [{ id: 'a', text: 'Eins' }] } as never)
  expect(r.result).toBe('Liste „Web“: Gespeichert, aber nicht hochgeladen.')
})

test('eine unveränderte Liste gilt als gespeichert, ohne Commit', async ($, on) => {
  const a = attrappe(on, { unveraendert: true })
  const r = await $.tool.call({ tool: SETZEN, slug: 'web', projekt: 'Web', punkte: [{ id: 'a', text: 'Alt' }] } as never)
  expect(r.result).toBe('Liste „Web“ gespeichert: 0 offen, 1 erledigt.')
  expect(a.git.map(g => g[0])).toEqual(['pull', 'add', 'diff'])
})

// ---- Eintragen, Abhaken, Aufräumen ----

test('punkte_hinzufuegen trägt normale Punkte ein, merkt die Sitzung, überspringt Doppelte und nimmt höchstens 5', async ($, on) => {
  const a = attrappe(on)
  const r = await $.tool.call({
    tool: HINZU,
    punkte: [
      { slug: 'web', projekt: 'Web', text: 'alt!' },
      ...['Eins', 'Zwei', 'Drei', 'Vier', 'Fünf', 'Sechs'].map(t => ({ slug: 'web', projekt: 'Web', text: `Punkt ${t}` })),
    ],
  } as never)
  expect(r.result).toContain('5 eingetragen, 1 schon vorhanden')
  const neue = a.liste().punkte.slice(1)
  expect(neue.map(p => p.text)).toEqual(['Punkt Eins', 'Punkt Zwei', 'Punkt Drei', 'Punkt Vier', 'Punkt Fünf'])
  expect(neue[4]).toEqual({ id: 'punkt-fuenf', text: 'Punkt Fünf', isDone: false, sitzung: 'sitzung-1', erstellt: HEUTE })
})

test('punkte_hinzufuegen legt eine neue Liste „Allgemein“ an', async ($, on) => {
  const a = attrappe(on)
  await $.tool.call({ tool: HINZU, punkte: [{ slug: 'allgemein', projekt: 'Allgemein', text: 'Steuer machen' }] } as never)
  expect(a.liste('allgemein')).toEqual({ projekt: 'Allgemein', punkte: [{ id: 'steuer-machen', text: 'Steuer machen', isDone: false, sitzung: 'sitzung-1', erstellt: HEUTE }] })
})

test('punkte_erledigt hakt ab', async ($, on) => {
  const a = attrappe(on, { punkte: [{ id: 'x', text: 'Offen', isDone: false, erstellt: '2026-10-19' }] })
  const r = await $.tool.call({ tool: ERLEDIGT, punkte: [{ slug: 'web', id: 'x' }] } as never)
  expect(r.result).toBe('1 abgehakt.')
  expect(a.liste().punkte[0]).toEqual({ id: 'x', text: 'Offen', isDone: true, erstellt: '2026-10-19', erledigtAm: HEUTE, geaendert: HEUTE })
})

// ---- Panel: graue Projektstreifen, kleine Links (Terminal: Knöpfe), nichts in den Chat ----

// Ein Element per key finden, egal ob Link (Markdown) oder Knopf
async function finde(ui: { find: (q: never) => Promise<unknown> }, key: string) {
  return (await ui.find({ type: 'Markdown', key } as never)) ?? (await ui.find({ type: 'Button', key } as never))
}
// Einen Link (mit seiner Adresse) oder Knopf drücken
async function klick(ui: { find: (q: never) => Promise<unknown>; press: (t: never) => Promise<unknown> }, key: string) {
  const md = await ui.find({ type: 'Markdown', key } as never)
  if (md !== undefined) {
    const href = /\]\((https:[^)\\"]+)\)/.exec(JSON.stringify(md))?.[1] ?? ''
    return ui.press({ key, link: { href } } as never)
  }
  return ui.press({ key } as never)
}

// Alle Punkte aufklappen (zugeklappt zeigen sie nur den Titel)
async function alleAuf(ui: { findAll: (q: never) => Promise<unknown[]>; find: (q: never) => Promise<unknown>; press: (t: never) => Promise<unknown> }) {
  for (const typ of ['Markdown', 'Button']) {
    for (const el of await ui.findAll({ type: typ } as never)) {
      const key = (el as { key?: string }).key ?? ''
      if (key.startsWith('pt-')) await klick(ui, key)
    }
  }
}

test('Erledigtes verschwindet nach 14 Tagen, Unberührtes bekommt nach 30 Tagen „alt?“', async ($, on) => {
  attrappe(on, {
    punkte: [
      { id: 'frisch', text: 'Frisch erledigt', isDone: true, erledigtAm: '2026-10-10' },
      { id: 'lange', text: 'Lange erledigt', isDone: true, erledigtAm: '2026-10-01' },
      { id: 'alt', text: 'Liegt herum', isDone: false, erstellt: '2026-09-01' },
      { id: 'jung', text: 'Ganz neu', isDone: false, erstellt: '2026-10-15' },
    ],
  })
  await $.tool.call({ tool: SETZEN, slug: 'web', projekt: 'Web', punkte: [{ id: 'frisch', text: 'Frisch erledigt' }, { id: 'lange', text: 'Lange erledigt' }, { id: 'alt', text: 'Liegt herum' }, { id: 'jung', text: 'Ganz neu' }] } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' } as never)
  await alleAuf(ui)
  // Erledigtes ist zugeklappt
  expect(await finde(ui, 'undo-web-frisch')).toBeUndefined()
  await klick(ui, 'bereich-erledigt-link')
  expect(await finde(ui, 'undo-web-frisch')).toBeDefined()
  expect(await finde(ui, 'undo-web-lange')).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '(alt?) Liegt herum' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '(alt?) Ganz neu' })).toBeUndefined()
})

test('Aufbau in der App: grauer Streifen je Projekt, kleine Links statt Knöpfe, oben Aktualisieren', async ($, on) => {
  attrappe(on, { punkte: [{ id: 'a', text: 'Offen', isDone: false, chat: `https://claude.ai/chat/${UUID}`, sitzung: 'sitzung-1' }] })
  await $.tool.call({ tool: SETZEN, slug: 'web', projekt: 'Web', punkte: [{ id: 'a', text: 'Offen' }] } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' } as never)
  await alleAuf(ui)
  expect(await ui.findAll({ type: 'Button' } as never)).toEqual([])
  const links = (await ui.findAll({ type: 'Markdown' } as never)).map(m => (m as { key?: string }).key)
  expect(links).toEqual(['reload', 'fold-web-link', 'pt-web-a', 'done-web-a', 'stale-web-a', 'chat-web-a', 'ask-web-a'])
  // „Zum Chat“ zeigt auf den echten Chat (Browser, falls die App den Klick nicht weitergibt)
  expect(JSON.stringify(await ui.find({ type: 'Markdown', key: 'chat-web-a' } as never))).toContain(`https://claude.ai/chat/${UUID}`)
  expect(await ui.find({ type: 'Link', text: 'Zum Chat' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /1 offen/ })).toBeDefined()
  expect(JSON.stringify(await ui.findAll({ type: 'Box' } as never))).toContain('#3A3A3C')
  await ui.unmount()
})

test('Aufbau im Terminal: Knöpfe und Web-Link', async ($, on) => {
  attrappe(on, { punkte: [{ id: 'a', text: 'Offen', isDone: false, chat: `https://claude.ai/chat/${UUID}`, sitzung: 'sitzung-1' }] })
  await $.tool.call({ tool: SETZEN, slug: 'web', projekt: 'Web', punkte: [{ id: 'a', text: 'Offen' }] } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  await alleAuf(ui)
  const knoepfe = (await ui.findAll({ type: 'Button' })).map(b => b.key)
  expect(knoepfe.filter(k => k?.endsWith('-web-a'))).toEqual(['pt-web-a', 'done-web-a', 'stale-web-a', 'chat-web-a', 'ask-web-a'])
  expect(await ui.find({ type: 'Link', text: 'Zum Chat' })).toBeDefined()
  await ui.unmount()
})

for (const surface of ['desktop', 'terminal'] as const) {
  test(`Erledigt hakt ab, meldet es und schreibt nichts in den Chat (${surface})`, async ($, on) => {
    const a = attrappe(on, { punkte: [{ id: 'a', text: 'Offen', isDone: false }] })
    await $.tool.call({ tool: SETZEN, slug: 'web', projekt: 'Web', punkte: [{ id: 'a', text: 'Offen' }] } as never)
    const ui = await $.ui.mount({ ...PANE, surface } as never)
    await alleAuf(ui)
    await klick(ui, 'done-web-a')
    expect(a.prompts).toEqual([])
    expect(a.liste().punkte[0]?.isDone).toBe(true)
    expect(await ui.find({ type: 'Text', text: 'Abgehakt: Offen' })).toBeDefined()
    await klick(ui, 'bereich-erledigt-link')
    expect(await finde(ui, 'undo-web-a')).toBeDefined()
    await klick(ui, 'undo-web-a')
    expect(a.liste().punkte[0]?.isDone).toBe(false)
    expect(await ui.find({ type: 'Text', text: 'Wieder offen: Offen' })).toBeDefined()
    expect(a.prompts).toEqual([])
  })

  test(`Zum Chat öffnet den Chat in der App, ohne Nachricht (${surface})`, async ($, on) => {
    const a = attrappe(on, { punkte: [{ id: 'a', text: 'Offen', isDone: false, chat: `https://claude.ai/chat/${UUID}` }] })
    await $.tool.call({ tool: SETZEN, slug: 'web', projekt: 'Web', punkte: [{ id: 'a', text: 'Offen' }] } as never)
    const ui = await $.ui.mount({ ...PANE, surface } as never)
    await alleAuf(ui)
    await klick(ui, 'chat-web-a')
    expect(a.geoeffnet).toEqual([['open', `claude://claude.ai/chat/${UUID}`]])
    expect(a.prompts).toEqual([])
  })

  test(`Veraltet markiert nur, zählt im Band nicht mit; Zurück hebt es auf (${surface})`, async ($, on) => {
    const a = attrappe(on, { punkte: [{ id: 'a', text: 'Offen', isDone: false }, { id: 'b', text: 'Zweiter', isDone: false }] })
    await $.tool.call({ tool: SETZEN, slug: 'web', projekt: 'Web', punkte: [{ id: 'a', text: 'Offen' }, { id: 'b', text: 'Zweiter' }] } as never)
    const ui = await $.ui.mount({ ...PANE, surface } as never)
    await alleAuf(ui)
    await klick(ui, 'stale-web-a')
    expect(a.prompts).toEqual([])
    expect(a.liste().punkte[0]?.veraltet).toBe(HEUTE)
    expect(await ui.find({ type: 'Text', text: 'Als veraltet markiert: Offen' })).toBeDefined()
    expect(await finde(ui, 'done-web-a')).toBeUndefined()
    // Veraltetes ist zugeklappt
    expect(await finde(ui, 'unstale-web-a')).toBeUndefined()
    await klick(ui, 'bereich-veraltet-link')
    expect(await finde(ui, 'unstale-web-a')).toBeDefined()
    const band = await $.ui.mount({ plugin: 'openpoints', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10 } } as never)
    expect(await band.find({ type: 'Text', text: 'Offene Punkte: Web 1' })).toBeDefined()
    await klick(ui, 'unstale-web-a')
    expect(a.liste().punkte[0]?.veraltet).toBeUndefined()
    expect(await finde(ui, 'done-web-a')).toBeDefined()
    expect(a.prompts).toEqual([])
  })

  test(`Frage dazu gibt es nur in der Sitzung, in der der Punkt entstand (${surface})`, async ($, on) => {
    const a = attrappe(on, {
      punkte: [
        { id: 'a', text: 'Von hier', isDone: false, sitzung: 'sitzung-1' },
        { id: 'b', text: 'Von woanders', isDone: false, sitzung: 'andere' },
        { id: 'c', text: 'Aus claude.ai', isDone: false, chat: `https://claude.ai/chat/${UUID}` },
      ],
    })
    await $.tool.call({ tool: SETZEN, slug: 'web', projekt: 'Web', punkte: [{ id: 'a', text: 'Von hier' }, { id: 'b', text: 'Von woanders' }, { id: 'c', text: 'Aus claude.ai' }] } as never)
    const ui = await $.ui.mount({ ...PANE, surface } as never)
    await alleAuf(ui)
    expect(await finde(ui, 'ask-web-a')).toBeDefined()
    expect(await finde(ui, 'ask-web-b')).toBeUndefined()
    expect(await finde(ui, 'ask-web-c')).toBeUndefined()
    await klick(ui, 'ask-web-a')
    // nur ins Eingabefeld gelegt, nichts abgeschickt
    expect(a.eingefuegt).toEqual(['Frage zu „Von hier“ (Web): Wie gehe ich da genau vor?'])
    expect(a.prompts).toEqual([])
  })
}

test('Projekt zuklappen und aufklappen', async ($, on) => {
  attrappe(on, { punkte: [{ id: 'a', text: 'Offen', isDone: false }] })
  await $.tool.call({ tool: SETZEN, slug: 'web', projekt: 'Web', punkte: [{ id: 'a', text: 'Offen' }] } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' } as never)
  await alleAuf(ui)
  expect(JSON.stringify(await ui.find({ type: 'Markdown', key: 'fold-web-link' } as never))).toContain('[−]')
  await klick(ui, 'fold-web-link')
  expect(await finde(ui, 'done-web-a')).toBeUndefined()
  expect(JSON.stringify(await ui.find({ type: 'Markdown', key: 'fold-web-link' } as never))).toContain('[⏷]')
  await klick(ui, 'fold-web-link')
  expect(await finde(ui, 'done-web-a')).toBeDefined()
})

test('auf dem Handy gibt es nur den Web-Link, keinen App-Knopf', async ($, on) => {
  attrappe(on, { punkte: [{ id: 'a', text: 'Offen', isDone: false, chat: `https://claude.ai/chat/${UUID}` }] })
  await $.tool.call({ tool: SETZEN, slug: 'web', projekt: 'Web', punkte: [{ id: 'a', text: 'Offen' }] } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'mobile' } as never)
  await alleAuf(ui)
  expect(await finde(ui, 'chat-web-a')).toBeUndefined()
  expect(await ui.find({ type: 'Link', text: 'Zum Chat' })).toBeDefined()
})

test('ohne gültigen Chat-Link weder App-Knopf noch Web-Link', async ($, on) => {
  attrappe(on, { punkte: [{ id: 'a', text: 'Offen', isDone: false, chat: 'https://example.com/x' }] })
  await $.tool.call({ tool: SETZEN, slug: 'web', projekt: 'Web', punkte: [{ id: 'a', text: 'Offen' }] } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' } as never)
  await alleAuf(ui)
  expect(await finde(ui, 'chat-web-a')).toBeUndefined()
  expect(await ui.find({ type: 'Link', text: 'Zum Chat' })).toBeUndefined()
})

// ---- Klären veralteter Punkte ----

test('punkte_klaeren: streichen, offen mit neuem Text, erledigt', async ($, on) => {
  const a = attrappe(on, {
    punkte: [
      { id: 'x', text: 'X', isDone: false, veraltet: '2026-10-10' },
      { id: 'y', text: 'Y', isDone: false, veraltet: '2026-10-10' },
      { id: 'z', text: 'Z', isDone: false, veraltet: '2026-10-10' },
    ],
  })
  expect((await $.tool.call({ tool: KLAEREN, slug: 'web', id: 'x', aktion: 'streichen' } as never)).result).toBe('Punkt x: streichen.')
  await $.tool.call({ tool: KLAEREN, slug: 'web', id: 'y', aktion: 'offen', text: 'Y neu' } as never)
  await $.tool.call({ tool: KLAEREN, slug: 'web', id: 'z', aktion: 'erledigt' } as never)
  expect(a.liste().punkte).toEqual([
    { id: 'y', text: 'Y neu', isDone: false, geaendert: HEUTE, erstellt: HEUTE },
    { id: 'z', text: 'Z', isDone: true, erledigtAm: HEUTE, geaendert: HEUTE, erstellt: HEUTE },
  ])
  expect((await $.tool.call({ tool: KLAEREN, slug: 'web', id: 'gibtsnicht', aktion: 'offen' } as never)).result).toContain('nicht gefunden')
})

// ---- Band über dem Eingabefeld ----

test('das Band zeigt die offenen Punkte und öffnet das Panel', async ($, on) => {
  const a = attrappe(on, { punkte: [{ id: 'a', text: 'Eins', isDone: false }, { id: 'b', text: 'Zwei', isDone: false }, { id: 'c', text: 'Drei', isDone: true }] })
  await $.tool.call({ tool: SETZEN, slug: 'web', projekt: 'Web', punkte: [{ id: 'a', text: 'Eins' }, { id: 'b', text: 'Zwei' }, { id: 'c', text: 'Drei' }] } as never)
  const ui = await $.ui.mount({ plugin: 'openpoints', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10 } } as never)
  expect(await ui.find({ type: 'Text', text: 'Offene Punkte: Web 2' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /neu/ })).toBeUndefined()
  // In der App ein kleiner Link, der das Panel öffnet
  expect(await ui.find({ type: 'Button', key: 'band-oeffnen' })).toBeUndefined()
  await ui.press({ key: 'band-oeffnen', link: { href: 'https://github.com/TJS-21/claude-openpoints-daten' } })
  expect(a.panes).toContain('openpoints')
})

test('Öffnen wird zu Einklappen und zurück', async ($, on) => {
  const a = attrappe(on, { punkte: [{ id: 'a', text: 'Eins', isDone: false }] })
  await $.tool.call({ tool: SETZEN, slug: 'web', projekt: 'Web', punkte: [{ id: 'a', text: 'Eins' }] } as never)
  const href = { href: 'https://github.com/TJS-21/claude-openpoints-daten' }
  const band = await $.ui.mount({ plugin: 'openpoints', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10 } } as never)
  const wort = async () => JSON.stringify(await band.find({ type: 'Markdown', key: 'band-oeffnen' } as never))
  expect(await wort()).toContain('[Öffnen]')
  await band.press({ key: 'band-oeffnen', link: href })
  expect(a.panes).toContain('openpoints')
  expect(await wort()).toContain('[Einklappen]')
  await band.press({ key: 'band-oeffnen', link: href })
  expect(a.geschlossen).toEqual(['openpoints'])
  expect(await wort()).toContain('[Öffnen]')
  await band.unmount()
})

test('im Terminal bleibt Öffnen ein Knopf', async ($, on) => {
  const a = attrappe(on, { punkte: [{ id: 'a', text: 'Eins', isDone: false }] })
  await $.tool.call({ tool: SETZEN, slug: 'web', projekt: 'Web', punkte: [{ id: 'a', text: 'Eins' }] } as never)
  const ui = await $.ui.mount({ plugin: 'openpoints', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10 } } as never)
  expect(await ui.find({ type: 'Button', key: 'band-oeffnen' })).toBeDefined()
  await ui.press({ key: 'band-oeffnen' })
  expect(a.panes).toContain('openpoints')
})

test('ein Band einer anderen Mod bleibt unter dem Band sichtbar', async ($, on) => {
  attrappe(on, { punkte: [{ id: 'a', text: 'Eins', isDone: false }] })
  // steht für eine andere Mod (z. B. die Nutzungsleiste) unter dieser
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, null, 'Nutzung: 5 Std 42%')
  })
  await $.tool.call({ tool: SETZEN, slug: 'web', projekt: 'Web', punkte: [{ id: 'a', text: 'Eins' }] } as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'openpoints', surface, component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10 } } as never)
    expect(await ui.find({ type: 'Text', text: 'Offene Punkte: Web 1' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Nutzung: 5 Std 42%/ })).toBeDefined()
    await ui.unmount()
  }
})

// ---- Regel im Systemprompt: vorschlagen im Chat, eintragen erst nach OK ----

const COMPOSE = { model: 'm', promptModel: 'm', tools: [], outputStyle: null, traits: [] }

test('die Regel steht als eigener Abschnitt im Systemprompt', async ($, on) => {
  on('prompt.compose', async () => ({ sections: [{ id: 'intro', text: 'Hallo', scope: 'shared' }] }) as never)
  const r = await $.prompt.compose({ ...COMPOSE, surfaces: ['desktop'] } as never)
  const regel = r.sections.find(s => s.id === 'openpoints:regeln')
  expect(regel?.scope).toBe('session')
  expect(regel?.text).toContain('punkte_hinzufuegen')
  expect(regel?.text).toContain('erst nach dem OK von Timo')
})

test('ohne Oberfläche (claude -p, z. B. aus n8n) keine Regel', async ($, on) => {
  on('prompt.compose', async () => ({ sections: [{ id: 'intro', text: 'Hallo', scope: 'shared' }] }) as never)
  const r = await $.prompt.compose({ ...COMPOSE, surfaces: [] } as never)
  expect(r.sections.map(s => s.id)).toEqual(['intro'])
})

// ---- Einstellungen: eigene Listen für andere Personen ----

const ANNA = { daten_repo: 'https://github.com/anna/listen', name: 'Anna Beispiel', email: 'anna@example.com' }
const ANNA_DIR = '/home/.claude/openpoints-daten-anna-listen'

test('ohne Einstellungen: Timos Repo, Timos Ordner, Timo als Autor', async ($, on) => {
  const a = attrappe(on)
  await $.tool.call({ tool: HINZU, punkte: [{ slug: 'web', projekt: 'Web', text: 'Etwas Neues' }] } as never)
  const commit = a.aufrufe.find(x => x.includes('commit')) ?? []
  expect(commit.slice(0, 7)).toEqual(['git', '-C', DIR, '-c', 'user.name=Timo Schroeder', '-c', 'user.email=223644582+TJS-21@users.noreply.github.com'])
  expect(a.aufrufe).toContainEqual(['mkdir', '-p', `${DIR}/punkte`])
})

test('eigene Einstellungen: eigenes Repo wird in einen eigenen Ordner geklont, eigener Autor', { options: ANNA }, async ($, on) => {
  const a = attrappe(on, { dir: ANNA_DIR, ohneKlon: true })
  const r = await $.tool.call({ tool: HINZU, punkte: [{ slug: 'allgemein', projekt: 'Allgemein', text: 'Steuer machen' }] } as never)
  expect(r.result).toContain('1 eingetragen')
  expect(a.aufrufe).toContainEqual(['git', 'clone', '-q', '--', 'https://github.com/anna/listen', ANNA_DIR])
  expect(a.aufrufe).toContainEqual(['mkdir', '-p', `${ANNA_DIR}/punkte`])
  const commit = a.aufrufe.find(x => x.includes('commit')) ?? []
  expect(commit.slice(0, 7)).toEqual(['git', '-C', ANNA_DIR, '-c', 'user.name=Anna Beispiel', '-c', 'user.email=anna@example.com'])
  expect(a.liste('allgemein').punkte.map(p => p.text)).toEqual(['Steuer machen'])
  expect(a.aufrufe.some(x => x.some(t => t.includes('TJS-21') || t.includes('Timo')))).toBe(false)
})

test('eigene Einstellungen: die Regel spricht den eigenen Vornamen an', { options: ANNA }, async ($, on) => {
  on('prompt.compose', async () => ({ sections: [] }) as never)
  const r = await $.prompt.compose({ ...COMPOSE, surfaces: ['desktop'] } as never)
  const regel = r.sections.find(s => s.id === 'openpoints:regeln')?.text ?? ''
  expect(regel).toContain('Anna führt projektübergreifend')
  expect(regel).toContain('erst nach dem OK von Anna')
  expect(regel).not.toContain('Timo')
})

test('leere Felder fallen auf die Voreinstellung zurück', { options: { daten_repo: '  ', name: '', email: '' } }, async ($, on) => {
  const a = attrappe(on)
  await $.tool.call({ tool: HINZU, punkte: [{ slug: 'web', projekt: 'Web', text: 'Etwas Neues' }] } as never)
  const commit = a.aufrufe.find(x => x.includes('commit')) ?? []
  expect(commit[2]).toBe(DIR)
  expect(commit[4]).toBe('user.name=Timo Schroeder')
})

test('eigenes Repo ohne Name und E-Mail: kein fremder Autor, eigene Git-Identität', { options: { daten_repo: 'https://github.com/anna/listen' } }, async ($, on) => {
  const a = attrappe(on, { dir: ANNA_DIR, ohneKlon: true })
  await $.tool.call({ tool: HINZU, punkte: [{ slug: 'allgemein', projekt: 'Allgemein', text: 'Steuer machen' }] } as never)
  const commit = a.aufrufe.find(x => x.includes('commit')) ?? []
  expect(commit.slice(0, 4)).toEqual(['git', '-C', ANNA_DIR, 'commit'])
  expect(a.aufrufe.some(x => x.some(t => t.includes('TJS-21') || t.includes('Timo')))).toBe(false)
})

test('Punkt zugeklappt: nur Titel und Pfeil rechts; aufgeklappt Kontext und Links', async ($, on) => {
  attrappe(on, { punkte: [{ id: 'a', text: 'Commits hochladen?', kontext: 'Vier Commits liegen nur lokal. Entscheiden, ob sie zu GitHub sollen.', isDone: false }] })
  await $.tool.call({ tool: SETZEN, slug: 'web', projekt: 'Web', punkte: [{ id: 'a', text: 'Commits hochladen?' }] } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' } as never)
  expect(await ui.find({ type: 'Text', text: 'Commits hochladen?' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Vier Commits/ })).toBeUndefined()
  expect(await finde(ui, 'done-web-a')).toBeUndefined()
  expect(JSON.stringify(await ui.find({ type: 'Markdown', key: 'pt-web-a' } as never))).toContain('[⏷]')
  await klick(ui, 'pt-web-a')
  expect(await ui.find({ type: 'Text', text: /Vier Commits/ })).toBeDefined()
  expect(await finde(ui, 'done-web-a')).toBeDefined()
  expect(JSON.stringify(await ui.find({ type: 'Markdown', key: 'pt-web-a' } as never))).toContain('[−]')
})

test('punkte_hinzufuegen speichert Titel und Kontext', async ($, on) => {
  const a = attrappe(on)
  await $.tool.call({ tool: HINZU, punkte: [{ slug: 'web', projekt: 'Web', text: 'Sitemap umstellen', kontext: '  Beim Launch in Search Console und Bing auf sitemap-index.xml umstellen.  ' }] } as never)
  const p = a.liste().punkte.find(x => x.text === 'Sitemap umstellen')
  expect(p?.kontext).toBe('Beim Launch in Search Console und Bing auf sitemap-index.xml umstellen.')
})

test('die Regel verlangt kurzen Titel und Kontext', async ($, on) => {
  on('prompt.compose', async () => ({ sections: [] }) as never)
  const r = await $.prompt.compose({ ...COMPOSE, surfaces: ['desktop'] } as never)
  const regel = r.sections.find(s => s.id === 'openpoints:regeln')?.text ?? ''
  expect(regel).toContain('kurzen Titel')
  expect(regel).toContain('`kontext`')
})

const APP = 'local_4d7250e4-e7c1-4806-8fb2-b7ef4b4c5dcf'

test('neue Punkte merken sich die Sitzung der App; „Zur Sitzung“ öffnet sie', async ($, on) => {
  const a = attrappe(on, { appSitzung: APP })
  await $.tool.call({ tool: HINZU, punkte: [{ slug: 'web', projekt: 'Web', text: 'Sitemap umstellen', kontext: 'Beim Launch.' }] } as never)
  const p = a.liste().punkte.find(x => x.text === 'Sitemap umstellen')
  expect(p?.sitzungApp).toBe(APP)
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface } as never)
    // Aufgeklappt bleibt aufgeklappt: nur beim ersten Mal aufklappen
    if (surface === 'desktop') await alleAuf(ui)
    expect(await finde(ui, `sitzung-web-${p?.id}`)).toBeDefined()
    await klick(ui, `sitzung-web-${p?.id}`)
    await ui.unmount()
  }
  expect(a.geoeffnet).toEqual([['open', `claude://claude.ai/epitaxy/${APP}`], ['open', `claude://claude.ai/epitaxy/${APP}`]])
  expect(a.prompts).toEqual([])
})

test('ohne App-Sitzung (Terminal) wird nichts gemerkt; am Handy kein „Zur Sitzung“', async ($, on) => {
  const a = attrappe(on, { punkte: [{ id: 'x', text: 'Alt', isDone: false, sitzungApp: APP }] })
  await $.tool.call({ tool: HINZU, punkte: [{ slug: 'web', projekt: 'Web', text: 'Neu ohne App' }] } as never)
  expect(a.liste().punkte.find(x => x.text === 'Neu ohne App')?.sitzungApp).toBeUndefined()
  const ui = await $.ui.mount({ ...PANE, surface: 'mobile' } as never)
  await alleAuf(ui)
  expect(await finde(ui, 'sitzung-web-x')).toBeUndefined()
})

test('eine unzulässige Sitzungskennung wird nicht geöffnet', async ($, on) => {
  const a = attrappe(on, { punkte: [{ id: 'x', text: 'Alt', isDone: false, sitzungApp: 'local_x; rm -rf ~' }] })
  await $.tool.call({ tool: SETZEN, slug: 'web', projekt: 'Web', punkte: [{ id: 'x', text: 'Alt' }] } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' } as never)
  await alleAuf(ui)
  expect(await finde(ui, 'sitzung-web-x')).toBeUndefined()
  expect(a.geoeffnet).toEqual([])
})
