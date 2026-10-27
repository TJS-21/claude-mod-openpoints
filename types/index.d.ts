export type Punkt = {
  id: string
  text: string
  isDone: boolean
  chat?: string
  /** Datum (JJJJ-MM-TT), an dem der Punkt in die Liste kam. */
  erstellt?: string
  /** Datum der letzten Änderung (Status, Text, Behalten). */
  geaendert?: string
  /** Datum, an dem der Punkt abgehakt wurde. */
  erledigtAm?: string
  /** Datum, an dem Timo den Punkt als veraltet markiert hat; geklärt wird im passenden Chat. */
  veraltet?: string
  /** Claude-Code-Sitzung, in der der Punkt entstand; nur dort gibt es „Frage dazu“. */
  sitzung?: string
}
export type Liste = { slug: string; projekt: string; punkte: Punkt[] }

declare module 'claude-code' {
  interface PluginState {
    openpoints: { listen: Liste[]; zu: string[]; meldung: string }
  }
}
