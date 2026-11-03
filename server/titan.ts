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
type DetailMarkets = { europe?: Market; asian?: Market; total?: Market; halfGoalHistory?: HalfGoalHistory }

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

export function parseGoals(source: string): Map<number, number[]> {
  const result = new Map<number, number[]>()
  for (const match of source.matchAll(/rq\[\d+\]="([\s\S]*?)";/g)) {
    const f = match[1].split('^')
    if (f[2] !== '1') continue
    const id = Number(f[0]); const minute = Number.parseInt(f[3], 10)
    if (!Number.isFinite(id) || !Number.isFinite(minute)) continue
    result.set(id, [...(result.get(id) ?? []), minute])
  }
  return result
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

async function getViaBrowser(requestedIds?: Set<number>) {
  const browser = await chromium.launch({ executablePath: browserExecutable(), headless: true })
  try {
    const page = await browser.newPage()
    await page.goto('https://live.titan007.com/', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForSelector('#table_live tr[id^="tr1_"]', { state: 'attached', timeout: 30_000 })
    await page.evaluate(() => (window as unknown as { loadBfOdds: () => void }).loadBfOdds())
    const payload = await page.evaluate(() => {
      const w = window as unknown as {
        A: string[][]
        flashData: { bfOddsList: { items: BrowserOddsGroup[] } }
      }
      return { schedules: w.A.slice(1), oddsGroups: w.flashData.bfOddsList.items }
    })
    const schedules: Schedule[] = payload.schedules.map((f) => ({
      id: Number(f[0]), league: clean(f[2]), home: clean(f[5] || f[4]), away: clean(f[8] || f[7]),
      scheduledAt: '', actualStart: titanDate(f[12]), state: score(f[13]), homeScore: score(f[14]), awayScore: score(f[15]),
      homeHalfScore: score(f[16]), awayHalfScore: score(f[17]),
    })).filter((m) => Number.isFinite(m.id) && m.state >= 1 && m.state <= 4 && (!requestedIds || requestedIds.has(m.id)))
    const details = await loadDetailMarkets(browser, schedules.map((match) => match.id))
    const histories = await loadHalfGoalHistories(browser, schedules.map((match) => match.id))
    const oddsById = new Map(payload.oddsGroups.map((group) => [Number(group.sId), group.oddsList.items]))
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
      let previousHome = 0; let previousAway = 0
      for (const item of live) {
        const home = Number(item.homeScore ?? 0); const away = Number(item.guestScore ?? 0)
        const eventMinute = Number.parseInt(clean(String(item.stateInfo ?? '')), 10)
        if (Number.isFinite(eventMinute)) {
          const events = goalEvents.get(match.id) ?? []
          for (let n = previousHome; n < home; n++) events.push({ minute: eventMinute, side: 'home' })
          for (let n = previousAway; n < away; n++) events.push({ minute: eventMinute, side: 'away' })
          if (events.length) { goalEvents.set(match.id, events); goals.set(match.id, events.map((event) => event.minute)) }
        }
        previousHome = Math.max(previousHome, home); previousAway = Math.max(previousAway, away)
      }
    }
    return formatResponse(schedules, odds, goals, 'Titan007 browser fallback', goalEvents, histories)
  } finally {
    await browser.close()
  }
}

function formatResponse(schedules: Schedule[], odds: Map<number, ParsedOdds>, goals: Map<number, number[]>, sourceName: string, goalEvents = new Map<number, GoalEvent[]>(), histories = new Map<number, HalfGoalHistory>()) {
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
  const supplementIds = new Set(direct.matches.filter((match) => !match.markets || (match.state === 1 && (match.minute ?? 0) >= 40) || match.state === 2).map((match) => match.id))
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
          sameMarketCount: match.markets ? match.sameMarketCount : supplement.sameMarketCount,
        }
      }),
    }
  } catch {
    return direct
  }
}
