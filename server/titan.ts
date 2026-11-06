import { existsSync } from 'node:fs'
import { chromium, type Browser, type Page } from 'playwright-core'

const TITAN = 'https://livestatic.titan007.com/vbsxml'
const HEADERS = {
  Referer: 'https://live.titan007.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
}

type Triple = { left: number | null; line: number | null; right: number | null }
type Market = { opening: Triple; current: Triple }
type ParsedOdds = { asian: Market; liveAsian?: Market; europe: Market; total: Market; halfAsian: Market; halfTotal: Market; halfEurope: Market }
type BrowserOddsItem = Record<string, string | number>
type BrowserOddsGroup = { sId: string; oddsList: { items: BrowserOddsItem[] } }
type TeamHalfHistory = { sample: number; withGoal: number }
type HalfGoalHistory = { home: TeamHalfHistory; away: TeamHalfHistory }
type GoalEvent = { minute: number; side: 'home' | 'away' | 'unknown' }
type TechnicalStatPair = { home: number | null; away: number | null }
type TechnicalStats = {
  shots: TechnicalStatPair
  shotsOnTarget: TechnicalStatPair
  possession: TechnicalStatPair
  dangerousAttacks: TechnicalStatPair
}
type MatchDetail = { goalEvents: GoalEvent[]; technicalStats?: TechnicalStats }
type DetailMarkets = { europe?: Market; asian?: Market; total?: Market; halfGoalHistory?: HalfGoalHistory }

export type MatchDetailEvent = {
  kind: number
  label: string
  minute: number
  extraMinute: number
  side: 'home' | 'away'
  player: string
  assist: string
  note: string
}

export type MatchDetailStatistic = {
  kind: number
  label: string
  home: string
  away: string
  homePercent: number
  awayPercent: number
}

interface Schedule {
  id: number
  league: string
  home: string
  away: string
  scheduledAt: string
  actualStart: string | null
  state: number
  homeScore: number
  awayScore: number
  homeHalfScore: number
  awayHalfScore: number
}

const num = (value: string | undefined): number | null => {
  const parsed = Number(value)
  return value !== undefined && value !== '' && Number.isFinite(parsed) ? parsed : null
}

const score = (value: string | undefined) => num(value) ?? 0
const clean = (value: string | undefined) => (value ?? '')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .trim()

const EVENT_LABELS: Record<number, string> = {
  1: '进球', 2: '红牌', 3: '黄牌', 6: '进球无效', 7: '点球', 8: '乌龙球', 9: '两黄变红', 11: '换人', 13: '射失点球', 14: '视频裁判',
}

const STAT_LABELS = '角球,半场角球,黄牌,红牌,射门,射正,进攻,危险进攻,射门不中,射门被挡,任意球,控球率,半场控球率,传球,传球成功率,犯规,越位,头球,头球成功,救球,铲球,换人数,过人,界外球,中柱,加时角球,加时越位,乌龙球,加时黄牌,守门员出击,丢球,成功抢断,阻截,成功传中,助攻,加时换人,长传,短传,先开球,第一张黄牌,最后一张黄牌,第一个换人,最后一个换人,第一个角球,最后一个角球,第一个越位,最后越位,预期进球(xG),运动战xG,定位球xG,非点球xG,射正xG,得分机会,错失得分机会,禁区内射门,禁区外射门,对方禁区触球,解围,地面对抗成功,争顶成功'.split(',')

function parseJsArrayLiteral(source: string): unknown[] | null {
  let cursor = 0
  const skip = () => { while (/\s/.test(source[cursor] ?? '')) cursor++ }
  const value = (): unknown => {
    skip()
    const char = source[cursor]
    if (char === '[') {
      cursor++
      const result: unknown[] = []
      skip()
      while (cursor < source.length && source[cursor] !== ']') {
        result.push(value())
        skip()
        if (source[cursor] === ',') { cursor++; skip() } else break
      }
      if (source[cursor] !== ']') throw new Error('数组未闭合')
      cursor++
      return result
    }
    if (char === "'" || char === '"') {
      const quote = char
      cursor++
      let result = ''
      while (cursor < source.length) {
        const current = source[cursor++]
        if (current === quote) return result
        if (current !== '\\') { result += current; continue }
        const escaped = source[cursor++]
        if (escaped === 'n') result += '\n'
        else if (escaped === 'r') result += '\r'
        else if (escaped === 't') result += '\t'
        else if (escaped === 'u') { result += String.fromCharCode(Number.parseInt(source.slice(cursor, cursor + 4), 16)); cursor += 4 }
        else if (escaped === 'x') { result += String.fromCharCode(Number.parseInt(source.slice(cursor, cursor + 2), 16)); cursor += 2 }
        else result += escaped
      }
      throw new Error('字符串未闭合')
    }
    const start = cursor
    while (cursor < source.length && !/[\s,\]]/.test(source[cursor])) cursor++
    const token = source.slice(start, cursor)
    if (token === 'null' || token === 'undefined' || token === '') return null
    if (token === 'true') return true
    if (token === 'false') return false
    const parsed = Number(token)
    return Number.isFinite(parsed) ? parsed : token
  }
  try {
    const parsed = value()
    return Array.isArray(parsed) ? parsed : null
  } catch { return null }
}

function assignmentArray(source: string, name: string, id: number): unknown[] {
  const marker = `${name}[${id}]=`
  const start = source.indexOf(marker)
  if (start < 0) return []
  const arrayStart = source.indexOf('[', start + marker.length)
  if (arrayStart < 0) return []
  let depth = 0; let quote = ''; let escaped = false
  for (let index = arrayStart; index < source.length; index++) {
    const char = source[index]
    if (quote) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) quote = ''
      continue
    }
    if (char === "'" || char === '"') { quote = char; continue }
    if (char === '[') depth++
    if (char === ']' && --depth === 0) return parseJsArrayLiteral(source.slice(arrayStart, index + 1)) ?? []
  }
  return []
}

const localized = (value: unknown) => clean(String(value ?? '').split('^')[0])

export function parseMatchDetail(source: string, id: number) {
  const rawEvents = assignmentArray(source, 'd_f', id)
  const rawStats = assignmentArray(source, 'tT_f', id)
  const events: MatchDetailEvent[] = rawEvents.filter(Array.isArray).map((row): MatchDetailEvent => ({
    kind: Number(row[0]), label: EVENT_LABELS[Number(row[0])] ?? '比赛事件', minute: Number(row[1]) || 0,
    extraMinute: Number(row[8]) || 0, side: Number(row[5]) === 1 ? 'home' : 'away',
    player: localized(row[6]), assist: localized(row[7]), note: localized(row[9]),
  })).filter((event) => event.minute >= 0).sort((a, b) => a.minute + a.extraMinute / 100 - b.minute - b.extraMinute / 100)
  const stats: MatchDetailStatistic[] = rawStats.filter(Array.isArray).map((row): MatchDetailStatistic => ({
    kind: Number(row[0]), label: STAT_LABELS[Number(row[0])] ?? `指标${row[0]}`,
    home: clean(String(row[1] ?? '—')) || '—', away: clean(String(row[2] ?? '—')) || '—',
    homePercent: Math.max(0, Math.min(100, Number(row[3]) || 0)), awayPercent: Math.max(0, Math.min(100, Number(row[4]) || 0)),
  })).filter((stat) => Number.isFinite(stat.kind))
  return { events, stats }
}

export async function getMatchDetail(id: number) {
  if (!Number.isInteger(id) || id <= 0) throw new Error('比赛编号无效')
  const response = await fetch(`${TITAN}/detailin.js?r=007${Date.now()}&id=${id}`, { headers: HEADERS, signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error(`Titan 比赛详情返回 ${response.status}`)
  return { fetchedAt: new Date().toISOString(), source: 'Titan007 实时比赛详情', ...parseMatchDetail(await response.text(), id) }
}

function titanDate(raw: string | undefined): string | null {
  if (!raw) return null
  const p = raw.split(',').map(Number)
  if (p.length < 5 || p.some(Number.isNaN)) return null
  const [year, month0, day, hour, minute, second = 0] = p
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${year}-${pad(month0 + 1)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}+08:00`
}

export function parseSchedules(source: string): Schedule[] {
  const result: Schedule[] = []
  const regex = /A\[\d+\]="([\s\S]*?)"\.split\('\^'\);/g
  for (const match of source.matchAll(regex)) {
    const f = match[1].split('^')
    const id = Number(f[0])
    if (!Number.isFinite(id)) continue
    result.push({
      id,
      league: clean(f[2]),
      home: clean(f[5] || f[4]),
      away: clean(f[8] || f[7]),
      scheduledAt: titanDate(f[11]) ?? '',
      actualStart: titanDate(f[12]),
      state: score(f[13]),
      homeScore: score(f[14]),
      awayScore: score(f[15]),
      homeHalfScore: score(f[16]),
      awayHalfScore: score(f[17]),
    })
  }
  return result
}

function triple(values: string[], offset: number): Triple {
  return { left: num(values[offset]), line: num(values[offset + 1]), right: num(values[offset + 2]) }
}

function market(raw: string | undefined): Market {
  const values = (raw ?? '').split(',').map((v) => v.replace(/["']/g, '').trim())
  return { opening: triple(values, 0), current: triple(values, 3) }
}

export function parseOdds(source: string): Map<number, ParsedOdds> {
  const result = new Map<number, ParsedOdds>()
  for (const match of source.matchAll(/sData\[(\d+)\]=\[(.*?)\];/gs)) {
    const groups = [...match[2].matchAll(/\[([^\]]*)\]/g)].map((item) => item[1])
    if (groups.length < 6) continue
    result.set(Number(match[1]), {
      asian: market(groups[0]), liveAsian: market(groups[0]), europe: market(groups[1]), total: market(groups[2]),
      halfAsian: market(groups[3]), halfTotal: market(groups[4]), halfEurope: market(groups[5]),
    })
  }
  return result
}

export function parseGoalRows(rows: string[]): Map<number, number[]> {
  const result = new Map<number, number[]>()
  for (const row of rows) {
    const f = row.split('^')
    if (f[2] !== '1') continue
    const id = Number(f[0]); const minute = Number.parseInt(f[3], 10)
    if (!Number.isFinite(id) || !Number.isFinite(minute)) continue
    result.set(id, [...(result.get(id) ?? []), minute])
  }
  return result
}

export function parseGoals(source: string): Map<number, number[]> {
  return parseGoalRows([...source.matchAll(/rq\[\d+\]="([\s\S]*?)";/g)].map((match) => match[1]))
}

export function parseDetailGoalEvents(source: string): GoalEvent[] {
  const eventList = source.match(/<ul\b[^>]*\bid=["']teamEventDiv["'][^>]*>([\s\S]*?)<\/ul>/i)?.[1] ?? ''
  const events: GoalEvent[] = []
  for (const row of eventList.matchAll(/<li\b[^>]*\bclass=["'][^"']*\blists\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi)) {
    const html = row[1]
    const icon = html.match(/<img\b[^>]*(?:title=["'](?:入球|点球|乌龙)["']|src=["'][^"']*\/bf_img2\/(?:1|7|8)\.png[^"']*["'])[^>]*>/i)
    const time = html.match(/(\d{1,3})(?:\s*\+\s*(\d{1,2}))?\s*['′]/)
    if (!icon || !time || icon.index === undefined || time.index === undefined) continue
    const minute = Number(time[1]) + Number(time[2] ?? 0)
    if (!Number.isFinite(minute)) continue
    events.push({ minute, side: icon.index < time.index ? 'home' : 'away' })
  }
  return events
}

export function parseTechnicalStats(source: string): TechnicalStats | undefined {
  const spanValues = [...source.matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/gi)]
    .map((match) => clean(match[1]).replace(/\s+/g, ' '))
  const barRows = [...source.matchAll(/<div\b[^>]*\bclass=["'][^"']*\bbarbox\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)]
    .map((match) => ({
      label: clean(match[1].match(/<span\b[^>]*\bclass=["'][^"']*\bdata\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1]),
      values: [...match[1].matchAll(/<span\b[^>]*\bclass=["'][^"']*\bvalue\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi)]
        .map((valueMatch) => clean(valueMatch[1])),
    }))
  const dataRows = [...source.matchAll(/<div\b[^>]*\bclass=["'][^"']*\bdata\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)]
    .map((match) => [...match[1].matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/gi)].map((spanMatch) => clean(spanMatch[1])))
  const aliases: Record<keyof TechnicalStats, string[]> = {
    shots: ['射门'],
    shotsOnTarget: ['射正'],
    possession: ['控球率', '控球时间'],
    dangerousAttacks: ['危险进攻'],
  }
  const result = {} as TechnicalStats
  let found = false
  const value = (raw: string | undefined) => {
    const parsed = Number.parseFloat((raw ?? '').replace('%', ''))
    return Number.isFinite(parsed) ? parsed : null
  }
  for (const [key, labels] of Object.entries(aliases) as [keyof TechnicalStats, string[]][]) {
    const barRow = barRows.find((row) => labels.includes(row.label) && row.values.length >= 2)
    const dataRow = dataRows.find((row) => row.length >= 3 && labels.includes(row[1]))
    const index = spanValues.findIndex((text) => labels.includes(text))
    const pair = barRow
      ? { home: value(barRow.values[0]), away: value(barRow.values.at(-1)) }
      : dataRow
        ? { home: value(dataRow[0]), away: value(dataRow.at(-1)) }
      : index > 0
        ? { home: value(spanValues[index - 1]), away: value(spanValues[index + 1]) }
        : { home: null, away: null }
    result[key] = pair
    if (pair.home !== null || pair.away !== null) found = true
  }
  return found ? result : undefined
}

function elapsedMinute(start: string | null, state: number): number | null {
  if (!start) return null
  const elapsed = Math.max(0, Math.floor((Date.now() - new Date(start).getTime()) / 60000))
  if (state === 1) return Math.min(45, elapsed)
  if (state === 2) return 45
  if (state >= 3) return Math.min(90, elapsed)
  return null
}

async function source(name: string): Promise<string> {
  let response: Response
  try {
    response = await fetch(`${TITAN}/${name}?r=007${Date.now()}`, { headers: HEADERS, signal: AbortSignal.timeout(10_000) })
  } catch {
    throw new Error('无法连接 Titan 即时数据源，请检查网络或稍后重试')
  }
  if (!response.ok) throw new Error(`Titan ${name} 返回 ${response.status}`)
  return response.text()
}

function emptyMarket(): Market {
  return { opening: { left: null, line: null, right: null }, current: { left: null, line: null, right: null } }
}

export function parseAsianLine(raw: unknown): number | null {
  const text = clean(String(raw ?? '')).replace('*', '').trim()
  const negative = String(raw ?? '').includes('*')
  const values: Record<string, number> = {
    '平手': 0, '平/半': 0.25, '半球': 0.5, '半/一': 0.75, '一球': 1,
    '一/球半': 1.25, '球半': 1.5, '球半/两': 1.75, '两球': 2,
    '两/两球半': 2.25, '两球半': 2.5, '两球半/三': 2.75, '三球': 3,
  }
  const value = values[text]
  return value === undefined ? null : negative ? -value : value
}

export function parseTotalLine(raw: unknown): number | null {
  const parts = String(raw ?? '').split('/').map(Number).filter(Number.isFinite)
  if (!parts.length) return null
  return parts.reduce((sum, value) => sum + value, 0) / parts.length
}

function browserMarket(item: BrowserOddsItem | undefined, kind: 'asian' | 'total'): Market {
  if (!item) return emptyMarket()
  const line = kind === 'asian' ? parseAsianLine(item.letgoal) : parseTotalLine(item.totalScore)
  const openingLine = kind === 'asian' ? parseAsianLine(item.letgoal_f) : parseTotalLine(item.totalScore_f)
  return {
    opening: {
      left: num(String(kind === 'asian' ? item.homeOdds_f ?? '' : item.upOdds_f ?? '')),
      line: openingLine,
      right: num(String(kind === 'asian' ? item.guestOdds_f ?? '' : item.downOdds_f ?? '')),
    },
    current: {
      left: num(String(kind === 'asian' ? item.homeOdds ?? '' : item.upOdds ?? '')),
      line,
      right: num(String(kind === 'asian' ? item.guestOdds ?? '' : item.downOdds ?? '')),
    },
  }
}

function remainingHalfMarket(market: Market, currentGoals: number, minute: number): Market {
  const share = Math.max(0, 45 - minute) / Math.max(1, 90 - minute)
  const convert = (line: number | null) => line === null ? null : Math.max(0.25, (line - currentGoals) * share)
  return {
    opening: { ...market.opening, line: convert(market.opening.line) },
    current: { ...market.current, line: convert(market.current.line) },
  }
}

function browserExecutable(): string {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/microsoft-edge',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ]
  const executable = candidates.find(existsSync)
  if (!executable) throw new Error('未找到 Edge 或 Chrome，无法启用浏览器数据通道')
  return executable
}

async function crowCells(page: Page, url: string): Promise<{ cells: string[]; html: string } | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 })
      const crow = page.locator('tr').filter({ hasText: /Crow/i }).first()
      const fallback = page.locator('tr[id^="oddstr_"], tr:has(td[oddstype="wholeLastOdds"])').first()
      const row = await crow.count() ? crow : fallback
      if (!await row.count()) return null
      return { cells: (await row.locator('td').allTextContents()).map((value) => value.trim()), html: await row.evaluate((element) => element.outerHTML) }
    } catch {
      if (attempt === 2) return null
      await page.waitForTimeout(350 * (attempt + 1))
    }
  }
  return null
}

function detailThreeWay(data: { cells: string[]; html: string } | null): Market | undefined {
  if (!data || data.cells.length < 5) return undefined
  const href = data.html.match(/href="[^"]*list2\.aspx\?[^"]*"/i)?.[0].replace(/&amp;/g, '&') ?? ''
  const params = new URLSearchParams(href.split('?')[1]?.replace(/"$/, '') ?? '')
  return {
    opening: { left: num(params.get('Win') ?? ''), line: num(params.get('Draw') ?? ''), right: num(params.get('Lost') ?? '') },
    current: { left: num(data.cells[2]), line: num(data.cells[3]), right: num(data.cells[4]) },
  }
}

function detailTwoWay(data: { cells: string[] } | null, kind: 'asian' | 'total'): Market | undefined {
  if (!data || data.cells.length < 9) return undefined
  const line = (value: string) => kind === 'asian' ? parseAsianLine(value) : parseTotalLine(value)
  return {
    opening: { left: num(data.cells[3]), line: line(data.cells[4]), right: num(data.cells[5]) },
    current: { left: num(data.cells[6]), line: line(data.cells[7]), right: num(data.cells[8]) },
  }
}

export function parseHalfGoalHistory(source: string): HalfGoalHistory | undefined {
  const teams = source.match(/var\s+hometeamid=(\d+),guestteamid=(\d+)/i)
  if (!teams) return undefined
  const homeId = Number(teams[1]); const awayId = Number(teams[2])
  const rows = [...source.matchAll(/a\[\d+\]=\[([^\]]+)\];/g)].map((match) => {
    const values = [...match[1].matchAll(/'[^']*'|[^,]+/g)].map((item) => item[0].trim().replace(/^'|'$/g, ''))
    return { homeId: Number(values[6]), awayId: Number(values[7]), halfHome: Number(values[10]), halfAway: Number(values[11]) }
  }).filter((row) => [row.homeId, row.awayId, row.halfHome, row.halfAway].every(Number.isFinite))
  const stats = (teamId: number): TeamHalfHistory => {
    const recent = rows.filter((row) => row.homeId === teamId || row.awayId === teamId).slice(0, 20)
    return { sample: recent.length, withGoal: recent.filter((row) => row.halfHome + row.halfAway > 0).length }
  }
  return { home: stats(homeId), away: stats(awayId) }
}

async function loadHalfGoalHistory(page: Page, id: number): Promise<HalfGoalHistory | undefined> {
  try {
    await page.goto(`https://bf.titan007.com/panlu/${id}cn.htm`, { waitUntil: 'domcontentloaded', timeout: 15_000 })
    const script = await page.locator('script').evaluateAll((elements) => elements.map((element) => element.textContent ?? '').find((text) => text.includes('hometeamid')) ?? '')
    return parseHalfGoalHistory(script)
  } catch { return undefined }
}

async function fetchHalfGoalHistory(id: number): Promise<HalfGoalHistory | undefined> {
  try {
    const response = await fetch(`https://bf.titan007.com/panlu/${id}cn.htm?r=${Date.now()}`, { headers: HEADERS, signal: AbortSignal.timeout(15_000) })
    if (!response.ok) return undefined
    return parseHalfGoalHistory(await response.text())
  } catch { return undefined }
}

async function loadDetailMarkets(browser: Browser, ids: number[]): Promise<Map<number, DetailMarkets>> {
  const result = new Map<number, DetailMarkets>(); let cursor = 0
  const workers = Array.from({ length: Math.min(4, ids.length) }, async () => {
    const page = await browser.newPage()
    try {
      while (cursor < ids.length) {
        const id = ids[cursor++]
        const europe = detailThreeWay(await crowCells(page, `https://1x2.titan007.com/Oddslist/${id}.htm`))
        const asian = detailTwoWay(await crowCells(page, `https://vip.titan007.com/AsianOdds_n.aspx?id=${id}`), 'asian')
        const total = detailTwoWay(await crowCells(page, `https://vip.titan007.com/OverDown_n.aspx?id=${id}`), 'total')
        result.set(id, { europe, asian, total })
      }
    } finally { await page.close() }
  })
  await Promise.all(workers)
  return result
}

async function loadHalfGoalHistories(browser: Browser, ids: number[]): Promise<Map<number, HalfGoalHistory>> {
  const result = new Map<number, HalfGoalHistory>(); let cursor = 0
  const workers = Array.from({ length: Math.min(4, ids.length) }, async () => {
    const page = await browser.newPage()
    try {
      while (cursor < ids.length) {
        const id = ids[cursor++]
        const history = await loadHalfGoalHistory(page, id)
        if (history) result.set(id, history)
      }
    } finally { await page.close() }
  })
  await Promise.all(workers)
  return result
}

async function loadMatchDetails(browser: Browser, ids: number[]): Promise<Map<number, MatchDetail>> {
  const result = new Map<number, MatchDetail>(); let cursor = 0
  const workers = Array.from({ length: Math.min(2, ids.length) }, async () => {
    const page = await browser.newPage()
    try {
      while (cursor < ids.length) {
        const id = ids[cursor++]
        try {
          await page.goto(`https://live.titan007.com/detail/${id}cn.htm`, { waitUntil: 'networkidle', timeout: 20_000 })
          await page.locator('#teamEventDiv li.lists').first().waitFor({ state: 'attached', timeout: 8_000 }).catch(() => undefined)
          await page.locator('#teamTechDiv_detail .data').filter({ hasText: '射正' }).first().waitFor({ state: 'attached', timeout: 6_000 }).catch(() => undefined)
          await page.locator('#teamTechDiv_detail .barbox').filter({ hasText: /控球率|危险进攻/ }).first().waitFor({ state: 'attached', timeout: 6_000 }).catch(() => undefined)
          await page.waitForTimeout(1_500)
          const html = await page.content()
          const goalEvents = parseDetailGoalEvents(html)
          const technicalStats = parseTechnicalStats(html)
          if (goalEvents.length || technicalStats) result.set(id, { goalEvents, technicalStats })
        } catch { /* The panel will show the source-missing state for this match. */ }
      }
    } finally { await page.close() }
  })
  await Promise.all(workers)
  return result
}

async function getViaBrowser(requestedIds?: Set<number>) {
  const browser = await chromium.launch({ executablePath: browserExecutable(), headless: true })
  try {
    const page = await browser.newPage()
    await page.goto('https://live.titan007.com/', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForSelector('#table_live tr[id^="tr1_"]', { state: 'attached', timeout: 30_000 })
    await page.evaluate(() => (window as unknown as { loadBfOdds: () => void }).loadBfOdds())
    await page.addScriptTag({ url: `${TITAN}/detail_ut.js?r=${Date.now()}` }).catch(() => undefined)
    const payload = await page.evaluate(() => {
      const w = window as unknown as {
        A: string[][]
        flashData: { bfOddsList: { items: BrowserOddsGroup[] } }
        rq?: Record<string, string> | string[]
      }
      return {
        schedules: w.A.slice(1),
        oddsGroups: w.flashData.bfOddsList.items,
        goalRows: Object.values(w.rq ?? {}).filter((row): row is string => typeof row === 'string'),
      }
    })
    const schedules: Schedule[] = payload.schedules.map((f) => ({
      id: Number(f[0]), league: clean(f[2]), home: clean(f[5] || f[4]), away: clean(f[8] || f[7]),
      scheduledAt: '', actualStart: titanDate(f[12]), state: score(f[13]), homeScore: score(f[14]), awayScore: score(f[15]),
      homeHalfScore: score(f[16]), awayHalfScore: score(f[17]),
    })).filter((m) => Number.isFinite(m.id) && m.state >= 1 && m.state <= 4 && (!requestedIds || requestedIds.has(m.id)))
    const details = await loadDetailMarkets(browser, schedules.map((match) => match.id))
    const histories = await loadHalfGoalHistories(browser, schedules.map((match) => match.id))
    const matchDetails = await loadMatchDetails(browser, schedules.map((match) => match.id))
    const oddsById = new Map(payload.oddsGroups.map((group) => [Number(group.sId), group.oddsList.items]))
    const feedGoals = parseGoalRows(payload.goalRows)
    const odds = new Map<number, ParsedOdds>()
    const goals = new Map<number, number[]>()
    const goalEvents = new Map<number, GoalEvent[]>()
    for (const match of schedules) {
      const items = oddsById.get(match.id) ?? []
      const pre = items.filter((item) => !String(item.ID).startsWith('3_')).at(-1) ?? items[0]
      const live = items.filter((item) => String(item.ID).startsWith('3_'))
      const latest = live.at(-1) ?? pre
      const detail = details.get(match.id)
      const asian = detail?.asian ?? browserMarket(pre, 'asian'); const total = detail?.total ?? browserMarket(pre, 'total')
      const liveAsian = browserMarket(latest, 'asian')
      const minute = elapsedMinute(match.actualStart, match.state) ?? 0
      const liveTotal = browserMarket(latest, 'total')
      const halfTotal = remainingHalfMarket(liveTotal.current.line === null ? total : liveTotal, match.homeScore + match.awayScore, minute)
      odds.set(match.id, { asian, liveAsian, total, halfAsian: emptyMarket(), halfTotal, europe: detail?.europe ?? emptyMarket(), halfEurope: emptyMarket() })
      const events = matchDetails.get(match.id)?.goalEvents ?? []
      if (events.length) {
        goalEvents.set(match.id, events)
        goals.set(match.id, events.map((event) => event.minute))
      }
      const loadedMinutes = feedGoals.get(match.id) ?? []
      if (loadedMinutes.length > (goals.get(match.id)?.length ?? 0)) goals.set(match.id, loadedMinutes)
    }
    return formatResponse(schedules, odds, goals, 'Titan007 browser fallback', goalEvents, histories, matchDetails)
  } finally {
    await browser.close()
  }
}

function formatResponse(schedules: Schedule[], odds: Map<number, ParsedOdds>, goals: Map<number, number[]>, sourceName: string, goalEvents = new Map<number, GoalEvent[]>(), histories = new Map<number, HalfGoalHistory>(), details = new Map<number, MatchDetail>()) {
  const groupCounts = new Map<string, number>()
  const key = (m: Schedule) => {
    const o = odds.get(m.id)
    return `${o?.halfAsian.current.line ?? 'x'}|${o?.halfTotal.current.line ?? 'x'}`
  }
  schedules.forEach((m) => groupCounts.set(key(m), (groupCounts.get(key(m)) ?? 0) + 1))
  return {
    fetchedAt: new Date().toISOString(),
    source: sourceName,
    matches: schedules.map((m) => ({
      ...m,
      minute: elapsedMinute(m.actualStart, m.state),
      goalMinutes: (goals.get(m.id) ?? []).sort((a, b) => a - b),
      goalEvents: (goalEvents.get(m.id) ?? []).sort((a, b) => a.minute - b.minute),
      halfGoalHistory: histories.get(m.id),
      technicalStats: details.get(m.id)?.technicalStats,
      markets: odds.get(m.id) ?? null,
      sameMarketCount: groupCounts.get(key(m)) ?? 1,
    })),
  }
}

export function capGoalEventsToScore(homeScore: number, awayScore: number, goalMinutes: number[], goalEvents: GoalEvent[]) {
  const verifiedGoalCount = Math.max(0, homeScore + awayScore)
  return { goalMinutes: goalMinutes.slice(0, verifiedGoalCount), goalEvents: goalEvents.slice(0, verifiedGoalCount) }
}

async function getViaDirectFeed() {
  const [scheduleText, oddsText, eventText] = await Promise.all([
    source('bfdata_ut.js'), source('sbOddsData.js'), source('detail_ut.js'),
  ])
  const schedules = parseSchedules(scheduleText).filter((m) => m.state >= 1 && m.state <= 4)
  const historyEntries = await Promise.all(schedules.map(async (match): Promise<[number, HalfGoalHistory] | null> => {
    const history = await fetchHalfGoalHistory(match.id)
    return history ? [match.id, history] : null
  }))
  return formatResponse(schedules, parseOdds(oddsText), parseGoals(eventText), 'Titan007 live public feed', new Map(), new Map(historyEntries.filter((entry): entry is [number, HalfGoalHistory] => entry !== null)))
}

export async function getLiveMatches() {
  let direct: Awaited<ReturnType<typeof getViaDirectFeed>>
  try {
    direct = await getViaDirectFeed()
  } catch {
    return getViaBrowser()
  }
  const supplementIds = new Set(direct.matches.filter((match) => match.state === 1 || match.state === 2).map((match) => match.id))
  if (!supplementIds.size) return direct
  try {
    const fallback = await getViaBrowser(supplementIds)
    const supplements = new Map(fallback.matches.map((match) => [match.id, match]))
    return {
      ...direct,
      source: 'Titan007 live public feed + browser supplement',
      matches: direct.matches.map((match) => {
        const supplement = supplements.get(match.id)
        if (!supplement) return match
        const lateVerification = (match.state === 1 && (match.minute ?? 0) >= 40) || match.state === 2
        const supplementHasNewerScore = lateVerification && supplement.homeScore + supplement.awayScore > match.homeScore + match.awayScore
        const homeScore = supplementHasNewerScore ? supplement.homeScore : match.homeScore
        const awayScore = supplementHasNewerScore ? supplement.awayScore : match.awayScore
        const candidateGoalMinutes = match.goalMinutes.length >= supplement.goalMinutes.length ? match.goalMinutes : supplement.goalMinutes
        const candidateGoalEvents = match.goalEvents.length >= supplement.goalEvents.length ? match.goalEvents : supplement.goalEvents
        const verifiedGoals = lateVerification ? capGoalEventsToScore(homeScore, awayScore, candidateGoalMinutes, candidateGoalEvents) : { goalMinutes: candidateGoalMinutes, goalEvents: candidateGoalEvents }
        return {
          ...match,
          homeScore,
          awayScore,
          homeHalfScore: supplementHasNewerScore ? supplement.homeHalfScore : match.homeHalfScore,
          awayHalfScore: supplementHasNewerScore ? supplement.awayHalfScore : match.awayHalfScore,
          markets: match.markets ?? supplement.markets,
          goalMinutes: verifiedGoals.goalMinutes,
          goalEvents: verifiedGoals.goalEvents,
          halfGoalHistory: match.halfGoalHistory ?? supplement.halfGoalHistory,
          technicalStats: supplement.technicalStats ?? match.technicalStats,
          sameMarketCount: match.markets ? match.sameMarketCount : supplement.sameMarketCount,
        }
      }),
    }
  } catch {
    return direct
  }
}
