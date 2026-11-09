// Texts in English and German, shared by panel and worker
export type Lang = 'en' | 'de'

export function isLang(v: unknown): v is Lang {
  return v === 'en' || v === 'de'
}

const en = {
  title: 'CI',
  connect: 'Connect Woodpecker',
  serverUrl: 'Server URL',
  token: 'Personal Access Token',
  tokenSaved: 'saved, leave empty to keep it',
  tokenPaste: 'Paste token',
  tokenHelp: 'Get a token in Woodpecker: profile (top right), User settings, Personal Access Token. It is stored encrypted in Orca.',
  language: 'Language',
  save: 'Save',
  cancel: 'Cancel',
  urlRule: 'URL must start with https:// (http:// only for localhost)',
  tokenMissing: 'Token missing',
  loading: 'Loading',
  loadingDetails: 'Loading details',
  detailError: 'Could not load details',
  logOf: 'Log of “{step}” (last lines)',
  openIn: 'Open in Woodpecker',
  noPipeline: 'no pipeline',
  noRunYet: 'No pipeline has run yet.',
  noMatch: 'No project matches.',
  searchLabel: 'Search',
  searchHint: 'Search…',
  failedTitle: 'Failed builds',
  errorTitle: 'Error',
  statusLabel: 'Status',
  refresh: 'Refresh',
  settings: 'Settings',
  allGreen: 'all green',
  nFailed: '{n} failed',
  nRunning: '{n} running',
  updated: 'Updated {time}',
  nProjects: '{n} projects',
  xOfY: '{x} of {y} projects',
  fAll: 'All',
  fFailed: 'Failed',
  fRunning: 'Running',
  fPassed: 'Passed',
  gDay: 'Last 24 hours',
  gWeek: 'This week',
  gOlder: 'Older',
  gNone: 'No pipeline yet',
  justNow: 'just now',
  minAgo: '{n} min ago',
  hAgo: '{n} h ago',
  dAgo: '{n} d ago',
  sSuccess: 'passed',
  sFailure: 'failed',
  sError: 'error',
  sKilled: 'killed',
  sRunning: 'running',
  sPending: 'pending',
  sBlocked: 'blocked',
  sDeclined: 'declined',
  sSkipped: 'skipped',
  barOk: 'CI ok',
  barSetup: 'CI setup',
  barError: 'CI error',
  barFailed: 'CI {n} failed',
  barRunning: 'CI {n} running',
  notifyFailed: 'CI failed: {name}'
}

const de: typeof en = {
  title: 'CI',
  connect: 'Woodpecker verbinden',
  serverUrl: 'Server-URL',
  token: 'Personal Access Token',
  tokenSaved: 'gespeichert, leer lassen zum Behalten',
  tokenPaste: 'Token einfügen',
  tokenHelp: 'Token in Woodpecker erstellen: Profil (oben rechts), Benutzereinstellungen, Personal Access Token. Er wird verschlüsselt in Orca gespeichert.',
  language: 'Sprache',
  save: 'Speichern',
  cancel: 'Abbrechen',
  urlRule: 'Die URL muss mit https:// beginnen (http:// nur für localhost)',
  tokenMissing: 'Token fehlt',
  loading: 'Lädt',
  loadingDetails: 'Details werden geladen',
  detailError: 'Details konnten nicht geladen werden',
  logOf: 'Log von „{step}“ (letzte Zeilen)',
  openIn: 'In Woodpecker öffnen',
  noPipeline: 'keine Pipeline',
  noRunYet: 'Es lief noch keine Pipeline.',
  noMatch: 'Kein Projekt passt.',
  searchLabel: 'Suche',
  searchHint: 'Suchen…',
  failedTitle: 'Fehlgeschlagene Builds',
  errorTitle: 'Fehler',
  statusLabel: 'Status',
  refresh: 'Aktualisieren',
  settings: 'Einstellungen',
  allGreen: 'alles grün',
  nFailed: '{n} rot',
  nRunning: '{n} laufen',
  updated: 'Stand {time}',
  nProjects: '{n} Projekte',
  xOfY: '{x} von {y} Projekten',
  fAll: 'Alle',
  fFailed: 'Fehlgeschlagen',
  fRunning: 'Laufend',
  fPassed: 'Erfolgreich',
  gDay: 'Letzte 24 Stunden',
  gWeek: 'Diese Woche',
  gOlder: 'Älter',
  gNone: 'Noch keine Pipeline',
  justNow: 'gerade eben',
  minAgo: 'vor {n} Min.',
  hAgo: 'vor {n} Std.',
  dAgo: 'vor {n} Tagen',
  sSuccess: 'erfolgreich',
  sFailure: 'fehlgeschlagen',
  sError: 'Fehler',
  sKilled: 'abgebrochen',
  sRunning: 'läuft',
  sPending: 'wartet',
  sBlocked: 'blockiert',
  sDeclined: 'abgelehnt',
  sSkipped: 'übersprungen',
  barOk: 'CI ok',
  barSetup: 'CI einrichten',
  barError: 'CI Fehler',
  barFailed: 'CI {n} rot',
  barRunning: 'CI {n} laufen',
  notifyFailed: 'CI fehlgeschlagen: {name}'
}

export type Key = keyof typeof en
const TEXTS: Record<Lang, typeof en> = { en, de }

export function t(lang: Lang, key: Key, vars: Record<string, string | number> = {}): string {
  return TEXTS[lang][key].replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''))
}

/** Fixed error texts of the plugin in German; unknown texts stay as they are */
const ERRORS_DE: Record<string, string> = {
  'Invalid server URL': 'Ungültige Server-URL',
  'Server URL must use https:// (http:// is only allowed for localhost)': 'Die Server-URL muss https:// nutzen (http:// nur für localhost)',
  'Response too large': 'Antwort zu groß',
  'Request failed (server unreachable or timed out)': 'Anfrage fehlgeschlagen (Server nicht erreichbar oder Zeitüberschreitung)',
  'The server redirects. Enter the final https:// URL of your Woodpecker server.': 'Der Server leitet weiter. Gib die endgültige https://-URL deines Woodpecker-Servers ein.',
  'Token invalid or lacks permission': 'Token ungültig oder ohne Berechtigung',
  'Token contains invalid characters': 'Der Token enthält ungültige Zeichen'
}

export function errorText(lang: Lang, message: string): string {
  if (lang === 'en') return message
  const m = /^Woodpecker answered with (\d+)$/.exec(message)
  if (m) return `Woodpecker antwortete mit ${m[1]}`
  return ERRORS_DE[message] ?? message
}
