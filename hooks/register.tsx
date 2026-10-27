import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Liste, Punkt } from '../types'

const PANE = 'openpoints'
const TITLE = 'Offene Punkte'
const TOOL_SETZEN = 'mcp__openpoints__punkte_setzen'
const TOOL_HINZU = 'mcp__openpoints__punkte_hinzufuegen'
const TOOL_ERLEDIGT = 'mcp__openpoints__punkte_erledigt'
const TOOL_KLAEREN = 'mcp__openpoints__punkte_klaeren'
// Voreinstellungen = Timos Werte; wer die Mod sonst nutzt, trägt beim Installieren eigene ein (userConfig in plugin.json).
const STANDARD = {
  datenRepo: 'https://github.com/TJS-21/claude-openpoints-daten',
  name: 'Timo Schroeder',
  email: '223644582+TJS-21@users.noreply.github.com',
}
let DATEN = STANDARD.datenRepo
let AUTOR = ['-c', `user.name=${STANDARD.name}`, '-c', `user.email=${STANDARD.email}`]
let VORNAME = 'Timo'
let REGELN = regeln(VORNAME)
const SLUG = /^[a-z0-9][a-z0-9-]*$/
const CHAT = /^https:\/\/claude\.ai\/chat\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/

// Aufräumregeln
const MAX_NEU = 5
const ERLEDIGT_TAGE = 14
const ALT_TAGE = 30

const listen = atom({ plugin: 'openpoints', key: 'listen' } as const, [])
const zu = atom({ plugin: 'openpoints', key: 'zu' } as const, [])
const meldung = atom({ plugin: 'openpoints', key: 'meldung' } as const, '')

type Eingabe = { slug: string; projekt: string; punkte: Array<{ id: string; text: string; isDone?: boolean; chat?: string }> }
type Neu = { slug: string; projekt: string; text: string; chat?: string }
type Verweis = { slug: string; id: string }

// Feste Regel im Systemprompt. Bewusst ohne die Listen selbst, damit der Prompt-Cache stabil bleibt.
// Punkte entstehen nur im Chat: Claude schlägt vor, die Person entscheidet dort mit vollem Zusammenhang.
function regeln(vorname: string): string {
  return [
    `Offene Punkte (Mod openpoints): ${vorname} führt projektübergreifend eine Liste offener Punkte.`,
    `Nennt deine Antwort Aufgaben oder Entscheidungen, die ${vorname} selbst erledigen muss und die nicht in dieser Antwort erledigt werden, oder wird etwas vertagt („später“, „vertagen wir“, „machen wir morgen“), dann frag am Ende kurz, ob du sie auf die Liste setzen sollst, mit Wortlaut und Projekt.`,
    `Trag erst nach dem OK von ${vorname} mit \`punkte_hinzufuegen\` ein. Nur eigene To-dos und offene Entscheidungen von ${vorname}, keine Alternativen zur Auswahl, nichts, was du gleich selbst erledigst, keine Rückfragen, die gerade beantwortet werden. Teilschritte zu einem Punkt zusammenfassen, kurz und auf Deutsch.`,
    'Projekt: ein vorhandenes Projekt, wenn es passt (das Ergebnis jedes Aufrufs nennt sie), sonst slug `allgemein`, Projekt „Allgemein“.',
    'Wird ein Punkt der Liste im Gespräch erledigt, hak ihn mit `punkte_erledigt` ab und erwähne das in einem Halbsatz.',
    `Punkte mit dem Feld \`veraltet\` hat ${vorname} als nicht mehr passend markiert. Kommt das Thema im Gespräch dran, kläre mit ${vorname}, ob der Punkt gestrichen, angepasst oder wieder offen sein soll, und trag das Ergebnis mit \`punkte_klaeren\` ein; nicht eigenmächtig.`,
  ].join('\n')
}

// Übernimmt die Einstellungen; leere Felder fallen auf die Voreinstellung zurück.
function einstellen(options: Readonly<Record<string, unknown>>) {
  const text = (k: string, standard: string) => (typeof options[k] === 'string' && (options[k] as string).trim() !== '' ? (options[k] as string).trim() : standard)
  DATEN = text('daten_repo', STANDARD.datenRepo)
  const name = text('name', STANDARD.name)
  AUTOR = ['-c', `user.name=${name}`, '-c', `user.email=${text('email', STANDARD.email)}`]
  VORNAME = name.split(/\s+/)[0] ?? name
  REGELN = regeln(VORNAME)
}

// Ordner der lokalen Kopie: bei Timos Repo wie bisher, bei jedem anderen ein eigener, damit nichts vermischt wird.
function ordnerName(): string {
  if (DATEN === STANDARD.datenRepo) return 'openpoints-daten'
  const teil = DATEN.replace(/\.git$/, '').split(/[/:]/).slice(-2).join('-').toLowerCase().replace(/[^a-z0-9-]+/g, '-')
  return `openpoints-daten-${teil}`
}

// Git-Vorgänge laufen nacheinander, auch wenn mehrere Knöpfe schnell hintereinander gedrückt werden.
let kette: Promise<unknown> = Promise.resolve()
function nacheinander<T>(f: () => Promise<T>): Promise<T> {
  const p = kette.then(f, f)
  kette = p.catch(() => undefined)
  return p
}

async function heute($: EngineInterface): Promise<string> {
  return new Date(await $.clock.now()).toISOString().slice(0, 10)
}

function tageSeit(datum: string | undefined, tag: string): number {
  if (datum === undefined) return 0
  return Math.floor((Date.parse(tag) - Date.parse(datum)) / 86400000)
}

function norm(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9äöüß]+/g, ' ').trim()
}

function neueId(text: string, vergeben: Set<string>): string {
  const umlaute: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' }
  const basis = norm(text).replace(/[äöüß]/g, c => umlaute[c] ?? c).split(' ').slice(0, 4).join('-') || 'punkt'
  let id = basis
  for (let n = 2; vergeben.has(id); n++) id = `${basis}-${n}`
  return id
}

async function ordner($: EngineInterface): Promise<string> {
  const { stdout } = await $.process.run(['sh', '-c', 'printf %s "$HOME"'])
  return `${stdout}/.claude/${ordnerName()}`
}

async function git($: EngineInterface, dir: string, args: string[]) {
  return $.process.run(['git', '-C', dir, ...AUTOR, ...args], { timeoutMs: 60000 })
}

// Holt den Stand von GitHub; bei einem Konflikt wird der Rebase abgebrochen, damit das Repo nicht hängen bleibt.
async function abgleichen($: EngineInterface, dir: string): Promise<string> {
  if (!(await $.fs.exists(`${dir}/.git`))) {
    const r = await $.process.run(['git', 'clone', '-q', DATEN, dir], { timeoutMs: 120000 })
    return r.exitCode === 0 ? '' : 'Daten-Repo nicht erreichbar. Ist Git bei GitHub angemeldet?'
  }
  const r = await git($, dir, ['pull', '--rebase', '--autostash', '-q'])
  if (r.exitCode === 0) return ''
  await git($, dir, ['rebase', '--abort'])
  return 'Abgleich mit GitHub fehlgeschlagen, zeige letzten Stand.'
}

async function liesListe($: EngineInterface, dir: string, datei: string): Promise<Liste | undefined> {
  try {
    const raw = JSON.parse(String(await $.fs.read(`${dir}/punkte/${datei}`))) as { projekt?: string; punkte?: Punkt[] }
    return { slug: datei.replace(/\.json$/, ''), projekt: raw.projekt ?? datei, punkte: raw.punkte ?? [] }
  } catch {
    return undefined
  }
}

async function einlesen($: EngineInterface, dir: string) {
  const eintraege = (await $.fs.exists(`${dir}/punkte`)) ? await $.fs.list(`${dir}/punkte`) : []
  const neu: Liste[] = []
  for (const f of eintraege) {
    if (!f.name.endsWith('.json')) continue
    const l = await liesListe($, dir, f.name)
    if (l) neu.push(l)
  }
  neu.sort((a, b) => a.projekt.localeCompare(b.projekt, 'de'))
  await update($, listen, () => neu)
}

function laden($: EngineInterface) {
  return nacheinander(async () => {
    const dir = await ordner($)
    const hinweis = await abgleichen($, dir)
    await update($, meldung, () => hinweis)
    await einlesen($, dir)
  }).catch(() => update($, meldung, () => 'Laden fehlgeschlagen.'))
}

// Gleicht ab, liest die Liste frisch von der Platte, ändert sie und lädt nur diese eine Datei hoch.
function aendern(
  $: EngineInterface,
  slug: string,
  f: (alt: Liste | undefined, tag: string) => Liste | undefined,
  nachricht: string,
) {
  return nacheinander(async () => {
    const dir = await ordner($)
    const hinweis = await abgleichen($, dir)
    if (hinweis !== '') {
      await update($, meldung, () => hinweis)
      return hinweis
    }
    const tag = await heute($)
    const geaendert = f(await liesListe($, dir, `${slug}.json`), tag)
    if (!geaendert) return 'Nichts geändert.'
    const punkte = geaendert.punkte.map(p => (p.erstellt === undefined ? { ...p, erstellt: tag } : p))
    const datei = `punkte/${slug}.json`
    // Ein frisches Daten-Repo hat noch keinen Ordner punkte/.
    await $.process.run(['mkdir', '-p', `${dir}/punkte`])
    await $.fs.write(`${dir}/${datei}`, JSON.stringify({ projekt: geaendert.projekt, punkte }, null, 2) + '\n')
    await git($, dir, ['add', '--', datei])
    // Unveränderte Liste: nichts zu committen, das ist kein Fehler.
    if ((await git($, dir, ['diff', '--cached', '--quiet', '--', datei])).exitCode === 0) {
      await update($, meldung, () => '')
      await einlesen($, dir)
      return ''
    }
    const c = await git($, dir, ['commit', '-q', '-m', nachricht, '--', datei])
    let p = c.exitCode === 0 ? await git($, dir, ['push', '-q']) : c
    if (c.exitCode === 0 && p.exitCode !== 0 && (await abgleichen($, dir)) === '') p = await git($, dir, ['push', '-q'])
    const ergebnis = c.exitCode !== 0 ? 'Gespeichert, aber nicht committet.' : p.exitCode !== 0 ? 'Gespeichert, aber nicht hochgeladen.' : ''
    await update($, meldung, () => ergebnis)
    await einlesen($, dir)
    return ergebnis
  })
}

// Ändert einen Punkt und vermerkt das Datum der Änderung.
function punktAendern($: EngineInterface, slug: string, id: string, f: (p: Punkt, tag: string) => Punkt, nachricht: string) {
  return aendern(
    $,
    slug,
    (alt, tag) => {
      if (!alt?.punkte.some(p => p.id === id)) return undefined
      return { ...alt, punkte: alt.punkte.map(p => (p.id === id ? { ...f(p, tag), geaendert: tag } : p)) }
    },
    nachricht,
  )
}

function setzeStatus($: EngineInterface, slug: string, id: string, isDone: boolean, text: string, projekt: string) {
  return punktAendern(
    $,
    slug,
    id,
    (p, tag) => {
      if (isDone) return { ...p, isDone: true, erledigtAm: tag }
      const { erledigtAm: _e, ...rest } = p
      return { ...rest, isDone: false }
    },
    `${projekt}: ${isDone ? 'erledigt' : 'wieder offen'} – ${text}`,
  )
}

function veraltetSetzen($: EngineInterface, slug: string, id: string, an: boolean, text: string, projekt: string) {
  return punktAendern(
    $,
    slug,
    id,
    (p, tag) => {
      if (an) return { ...p, veraltet: tag }
      const { veraltet: _v, ...rest } = p
      return rest
    },
    `${projekt}: ${an ? 'als veraltet markiert' : 'wieder offen'} – ${text}`,
  )
}

// Rückmeldung in der Leiste: sofort „läuft“, nach dem Speichern „fertig“; Fehler meldet aendern selbst.
async function mitMeldung($: EngineInterface, laeuft: string, fertig: string, f: () => Promise<string>) {
  await update($, meldung, () => laeuft)
  const r = await f()
  if (r === '') await update($, meldung, () => fertig)
}

function weg($: EngineInterface, slug: string, id: string, text: string, projekt: string) {
  return aendern(
    $,
    slug,
    alt => (alt?.punkte.some(p => p.id === id) ? { ...alt, punkte: alt.punkte.filter(p => p.id !== id) } : undefined),
    `${projekt}: entfernt – ${text}`,
  )
}

// Trägt neue Punkte ein, ohne Doppelte (auch sinngemäß gleicher Wortlaut) und höchstens MAX_NEU auf einmal.
async function hinzufuegen(
  $: EngineInterface,
  eintraege: Neu[],
  sitzung?: string,
): Promise<{ dazu: number; doppelt: number; fehler: string }> {
  let dazu = 0
  let doppelt = 0
  let fehler = ''
  const gruppen = new Map<string, Neu[]>()
  for (const e of eintraege) gruppen.set(e.slug, [...(gruppen.get(e.slug) ?? []), e])
  for (const [slug, gruppe] of gruppen) {
    const ergebnis = await aendern(
      $,
      slug,
      (alt, tag) => {
        const basis: Liste = alt ?? { slug, projekt: gruppe[0]?.projekt ?? slug, punkte: [] }
        const bekannt = new Set(basis.punkte.map(p => norm(p.text)))
        const ids = new Set(basis.punkte.map(p => p.id))
        const neue: Punkt[] = []
        for (const e of gruppe) {
          const n = norm(e.text)
          if (n === '' || bekannt.has(n)) {
            doppelt++
            continue
          }
          if (dazu >= MAX_NEU) break
          bekannt.add(n)
          const id = neueId(e.text, ids)
          ids.add(id)
          dazu++
          neue.push({
            id,
            text: e.text.trim(),
            isDone: false,
            ...(e.chat !== undefined && e.chat.startsWith('https://') ? { chat: e.chat } : {}),
            ...(sitzung !== undefined ? { sitzung } : {}),
            erstellt: tag,
          })
        }
        return neue.length > 0 ? { ...basis, punkte: [...basis.punkte, ...neue] } : undefined
      },
      `${gruppe[0]?.projekt ?? slug}: eingetragen`,
    )
    if (ergebnis !== '' && ergebnis !== 'Nichts geändert.') fehler = ergebnis
  }
  return { dazu, doppelt, fehler }
}

async function erledigen($: EngineInterface, verweise: Verweis[]): Promise<number> {
  let anzahl = 0
  const gruppen = new Map<string, string[]>()
  for (const v of verweise) gruppen.set(v.slug, [...(gruppen.get(v.slug) ?? []), v.id])
  for (const [slug, ids] of gruppen) {
    await aendern(
      $,
      slug,
      (alt, tag) => {
        if (!alt) return undefined
        let geaendert = false
        const punkte = alt.punkte.map(p => {
          if (!ids.includes(p.id) || p.isDone) return p
          geaendert = true
          anzahl++
          return { ...p, isDone: true, erledigtAm: tag, geaendert: tag }
        })
        return geaendert ? { ...alt, punkte } : undefined
      },
      `${slug}: abgehakt`,
    )
  }
  return anzahl
}

function projekteText(alle: Liste[]): string {
  if (alle.length === 0) return 'Noch keine Projekte.'
  return alle.map(l => `${l.projekt} (slug ${l.slug})`).join(', ')
}

// Öffnet den Chat in der Claude-App auf dem Mac statt im Browser.
async function zumChat($: EngineInterface, id: string) {
  const r = await $.process.run(['open', `claude://claude.ai/chat/${id}`])
  if (r.exitCode !== 0) await update($, meldung, () => 'Chat konnte nicht in der App geöffnet werden.')
}

export const register: Register = (on, options) => {
  einstellen(options)

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'offene-punkte', description: 'Seitenleiste „Offene Punkte“ öffnen' })
    await $.tool.register({
      name: 'punkte_setzen',
      isDeferred: false,
      description:
        `Setzt die Liste „Offene Punkte“ von ${VORNAME} für ein Projekt vollständig neu (eigene To-dos, kurz, auf Deutsch). Für einzelne neue Punkte punkte_hinzufuegen nehmen. ` +
        'slug ist der Dateiname ohne .json, nur Kleinbuchstaben, Ziffern und Bindestriche (z. B. website-bauen), projekt der Anzeigename. ' +
        'Gib die vollständige Liste an; Punkte mit gleicher id behalten Status und Chat-Link, außer isDone bzw. chat ist gesetzt. ' +
        'Gib bei neuen Punkten möglichst den Link des Chats an, in dem sie entstanden sind.',
      inputSchema: {
        type: 'object',
        properties: {
          slug: { type: 'string', pattern: SLUG.source },
          projekt: { type: 'string' },
          punkte: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                text: { type: 'string' },
                isDone: { type: 'boolean' },
                chat: { type: 'string', description: 'Link zum Chat, in dem der Punkt entstanden ist (https://claude.ai/chat/…)' },
              },
              required: ['id', 'text'],
            },
          },
        },
        required: ['slug', 'projekt', 'punkte'],
      },
    })
    await $.tool.register({
      name: 'punkte_hinzufuegen',
      isDeferred: false,
      description:
        `Trägt neue offene Punkte in die Liste von ${VORNAME} ein, nach Zustimmung im Chat; Doppelte werden übersprungen. ` +
        'slug: vorhandenes Projekt oder „allgemein“ (projekt „Allgemein“).',
      inputSchema: {
        type: 'object',
        properties: {
          punkte: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                slug: { type: 'string', pattern: SLUG.source },
                projekt: { type: 'string' },
                text: { type: 'string' },
                chat: { type: 'string', description: 'Link zum Chat, falls bekannt (https://claude.ai/chat/…)' },
              },
              required: ['slug', 'projekt', 'text'],
            },
          },
        },
        required: ['punkte'],
      },
    })
    await $.tool.register({
      name: 'punkte_erledigt',
      isDeferred: false,
      description: `Hakt Punkte in der Liste von ${VORNAME} ab, die im Gespräch erledigt wurden (slug und id des Punkts).`,
      inputSchema: {
        type: 'object',
        properties: {
          punkte: {
            type: 'array',
            items: { type: 'object', properties: { slug: { type: 'string' }, id: { type: 'string' } }, required: ['slug', 'id'] },
          },
        },
        required: ['punkte'],
      },
    })
    await $.tool.register({
      name: 'punkte_klaeren',
      isDeferred: false,
      description:
        `Trägt das Ergebnis ein, nachdem du einen als veraltet markierten Punkt mit ${VORNAME} geklärt hast: ` +
        'aktion „streichen“ (löschen), „offen“ (Markierung weg, optional mit neuem text) oder „erledigt“ (abhaken).',
      inputSchema: {
        type: 'object',
        properties: {
          slug: { type: 'string', pattern: SLUG.source },
          id: { type: 'string' },
          aktion: { type: 'string', enum: ['streichen', 'offen', 'erledigt'] },
          text: { type: 'string', description: 'Neuer Wortlaut, nur bei aktion „offen“' },
        },
        required: ['slug', 'id', 'aktion'],
      },
    })
    const started = await next(e)
    void laden($)
    void $.ui.open({ id: PANE, title: TITLE })
    return started
  })

  on('command.run', { command: 'offene-punkte' }, async $ => {
    await laden($)
    const r = await $.ui.open({ id: PANE, title: TITLE })
    return { text: r.isPlaced ? 'Seitenleiste geöffnet.' : `Nicht angezeigt: ${'reason' in r ? r.reason : 'unbekannt'}` }
  })

  // Die Regel steht in jedem Systemprompt einer sichtbaren Sitzung (nicht bei `claude -p`, etwa aus n8n).
  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    if (e.surfaces.length === 0) return r
    return { ...r, sections: [...r.sections, { id: 'openpoints:regeln', text: REGELN, scope: 'session' as const }] }
  })

  on('tool.call', { tool: TOOL_SETZEN }, async ($, e) => {
    const input = e as unknown as Eingabe
    if (!SLUG.test(input.slug)) return { deny: `Ungültiger slug „${input.slug}“: nur Kleinbuchstaben, Ziffern und Bindestriche.` }
    const sitzung = await $.session.id()
    const neu = (alt: Liste | undefined, tag: string): Liste => ({
      slug: input.slug,
      projekt: input.projekt,
      punkte: input.punkte.map(p => {
        const vorher = alt?.punkte.find(a => a.id === p.id)
        const chat = p.chat ?? vorher?.chat
        const isDone = p.isDone ?? vorher?.isDone ?? false
        const anders = vorher === undefined || vorher.text !== p.text || vorher.isDone !== isDone
        return {
          ...(vorher ?? {}),
          id: p.id,
          text: p.text,
          isDone,
          ...(chat !== undefined ? { chat } : {}),
          ...(anders && vorher !== undefined ? { geaendert: tag } : {}),
          ...(vorher === undefined ? { sitzung } : {}),
          ...(isDone && vorher?.isDone !== true ? { erledigtAm: tag } : {}),
        }
      }),
    })
    const fehler = await aendern($, input.slug, neu, `${input.projekt}: Liste aktualisiert`)
    if (fehler !== '') return { result: `Liste „${input.projekt}“: ${fehler}` }
    const gespeichert = (await read($, listen)).find(l => l.slug === input.slug)
    const punkte = gespeichert?.punkte ?? []
    const offen = punkte.filter(p => !p.isDone).length
    return { result: `Liste „${input.projekt}“ gespeichert: ${offen} offen, ${punkte.length - offen} erledigt.` }
  })

  on('tool.call', { tool: TOOL_HINZU }, async ($, e) => {
    const input = e as unknown as { punkte: Neu[] }
    const falsch = input.punkte.find(p => !SLUG.test(p.slug))
    if (falsch) return { deny: `Ungültiger slug „${falsch.slug}“: nur Kleinbuchstaben, Ziffern und Bindestriche.` }
    const r = await hinzufuegen($, input.punkte, await $.session.id())
    const projekte = projekteText(await read($, listen))
    const teile = [`${r.dazu} eingetragen`, ...(r.doppelt > 0 ? [`${r.doppelt} schon vorhanden`] : []), ...(r.fehler !== '' ? [r.fehler] : [])]
    return { result: `${teile.join(', ')}. Projekte: ${projekte}.` }
  })

  on('tool.call', { tool: TOOL_ERLEDIGT }, async ($, e) => {
    const input = e as unknown as { punkte: Verweis[] }
    const n = await erledigen($, input.punkte.filter(p => SLUG.test(p.slug)))
    return { result: `${n} abgehakt.` }
  })

  on('tool.call', { tool: TOOL_KLAEREN }, async ($, e) => {
    const input = e as unknown as { slug: string; id: string; aktion: 'streichen' | 'offen' | 'erledigt'; text?: string }
    if (!SLUG.test(input.slug)) return { deny: `Ungültiger slug „${input.slug}“: nur Kleinbuchstaben, Ziffern und Bindestriche.` }
    const projekt = (await read($, listen)).find(l => l.slug === input.slug)?.projekt ?? input.slug
    let r: string
    if (input.aktion === 'streichen') {
      r = await weg($, input.slug, input.id, input.id, projekt)
    } else {
      r = await punktAendern(
        $,
        input.slug,
        input.id,
        (p, tag) => {
          const { veraltet: _v, ...rest } = p
          if (input.aktion === 'erledigt') return { ...rest, isDone: true, erledigtAm: tag }
          return input.text !== undefined && input.text.trim() !== '' ? { ...rest, text: input.text.trim() } : rest
        },
        `${projekt}: geklärt (${input.aktion}) – ${input.id}`,
      )
    }
    if (r === 'Nichts geändert.') return { result: `Punkt ${input.id} in ${input.slug} nicht gefunden.` }
    return { result: r === '' ? `Punkt ${input.id}: ${input.aktion}.` : r }
  })

  // Schmales Band über dem Eingabefeld: immer sichtbare Erinnerung.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const alle = await read($, listen)
    const teile = alle.map(l => ({ projekt: l.projekt, n: l.punkte.filter(p => !p.isDone && p.veraltet === undefined).length })).filter(x => x.n > 0)
    if (teile.length === 0) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" gap={1}>
        <Text dimColor>
          Offene Punkte: {teile.map(x => `${x.projekt} ${x.n}`).join(' · ')}
        </Text>
        <Button key="band-oeffnen" onPress={() => void $.ui.open({ id: PANE, title: TITLE })}>
          Öffnen
        </Button>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const alle = await read($, listen)
    const zugeklappt = await read($, zu)
    const hinweis = await read($, meldung)
    const tag = await heute($)
    const sitzung = await $.session.id()
    // Auf dem Handy liefe `open` auf dem Mac, nicht auf dem Handy: dort nur der Web-Link.
    const inApp = e.surface !== 'mobile'

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={1}>
          <Button key="reload" onPress={() => void laden($)}>Aktualisieren</Button>
        </Box>
        {hinweis !== '' && <Text dimColor>{hinweis}</Text>}
        {alle.length === 0 && <Text dimColor>Noch keine Listen.</Text>}
        {alle.map(l => {
          const offen = l.punkte.filter(p => !p.isDone && p.veraltet === undefined)
          const veraltet = l.punkte.filter(p => !p.isDone && p.veraltet !== undefined)
          const erledigt = l.punkte.filter(p => p.isDone && tageSeit(p.erledigtAm, tag) < ERLEDIGT_TAGE)
          const istZu = zugeklappt.includes(l.slug)
          return (
            <Box flexDirection="column" gap={1}>
              <Box flexDirection="row" gap={1}>
                <Text bold>{l.projekt} ({offen.length})</Text>
                <Button
                  key={`fold-${l.slug}`}
                  onPress={() => void update($, zu, z => (istZu ? z.filter(s => s !== l.slug) : [...z, l.slug]))}
                >
                  {istZu ? 'Aufklappen' : 'Zuklappen'}
                </Button>
              </Box>
              {!istZu && offen.map(p => {
                const chatId = p.chat !== undefined ? CHAT.exec(p.chat)?.[1] : undefined
                const alt = tageSeit(p.geaendert ?? p.erstellt, tag) >= ALT_TAGE
                return (
                  <Box flexDirection="column">
                    <Text>{alt ? '(alt?) ' : ''}{p.text}</Text>
                    {p.chat !== undefined && p.chat !== '' && <Link href={p.chat}>Zum Chat</Link>}
                    <Box flexDirection="row" gap={1}>
                      <Button
                        key={`done-${l.slug}-${p.id}`}
                        onPress={() => void mitMeldung($, `Hake ab: ${p.text}`, `Abgehakt: ${p.text}`, () => setzeStatus($, l.slug, p.id, true, p.text, l.projekt))}
                      >
                        Erledigt
                      </Button>
                      {inApp && chatId !== undefined && (
                        <Button key={`chat-${l.slug}-${p.id}`} onPress={() => void zumChat($, chatId)}>
                          Zum Chat
                        </Button>
                      )}
                      {p.sitzung !== undefined && p.sitzung === sitzung && (
                        <Button
                          key={`ask-${l.slug}-${p.id}`}
                          onPress={() => void $.prompt.submit({ text: `Frage zu „${p.text}“ (${l.projekt}): Wie gehe ich da genau vor?`, asUser: true })}
                        >
                          Frage dazu
                        </Button>
                      )}
                      <Button
                        key={`stale-${l.slug}-${p.id}`}
                        onPress={() => void mitMeldung($, `Markiere: ${p.text}`, `Als veraltet markiert: ${p.text}`, () => veraltetSetzen($, l.slug, p.id, true, p.text, l.projekt))}
                      >
                        Veraltet
                      </Button>
                    </Box>
                  </Box>
                )
              })}
              {!istZu && veraltet.length > 0 && <Text dimColor>Als veraltet markiert:</Text>}
              {!istZu && veraltet.map(p => (
                <Box flexDirection="row" gap={1}>
                  <Text dimColor>{p.text}</Text>
                  <Button
                    key={`unstale-${l.slug}-${p.id}`}
                    onPress={() => void mitMeldung($, `Hole zurück: ${p.text}`, `Wieder offen: ${p.text}`, () => veraltetSetzen($, l.slug, p.id, false, p.text, l.projekt))}
                  >
                    Zurück
                  </Button>
                </Box>
              ))}
              {!istZu && erledigt.map(p => (
                <Box flexDirection="row" gap={1}>
                  <Text dimColor>✓ {p.text}</Text>
                  <Button
                    key={`undo-${l.slug}-${p.id}`}
                    onPress={() => void mitMeldung($, `Hole zurück: ${p.text}`, `Wieder offen: ${p.text}`, () => setzeStatus($, l.slug, p.id, false, p.text, l.projekt))}
                  >
                    Zurück
                  </Button>
                </Box>
              ))}
            </Box>
          )
        })}
      </Box>
    )
  })
}
