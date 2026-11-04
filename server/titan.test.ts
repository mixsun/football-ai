import { describe, expect, it } from 'vitest'
import { capGoalEventsToScore, parseAsianLine, parseGoals, parseHalfGoalHistory, parseMatchDetail, parseOdds, parseSchedules, parseTotalLine } from './titan.ts'

describe('Titan feed parsers', () => {
  it('parses an in-play schedule record', () => {
    const fields = Array(18).fill('')
    Object.assign(fields, { 0: '9', 2: '测试联赛', 5: '主队简', 8: '客队简', 11: '2026,10,2,17,30,0', 12: '2026,10,2,17,28,0', 13: '1' })
    const rows = parseSchedules(`A[0]="${fields.join('^')}".split('^');`)
    expect(rows[0]).toMatchObject({ id: 9, league: '测试联赛', home: '主队简', away: '客队简', state: 1 })
  })
  it('maps six market groups and current half total', () => {
    const group = `[0.9,0,0.9,0.8,0,1.0,0,0,0]`
    const odds = parseOdds(`sData[9]=[${group},${group},${group},${group},[0.9,1,0.9,0.82,1.25,1.02,0,0,0],${group}];`)
    expect(odds.get(9)?.halfTotal.current).toEqual({ left: 0.82, line: 1.25, right: 1.02 })
  })
  it('keeps goals and ignores non-goal events', () => {
    const goals = parseGoals(`rq[0]="9^1^1^18";rq[1]="9^1^3^22";`)
    expect(goals.get(9)).toEqual([18])
  })
  it('drops a late goal event when the confirmed score remains goalless', () => {
    expect(capGoalEventsToScore(0, 0, [45], [{ minute: 45, side: 'away' }])).toEqual({ goalMinutes: [], goalEvents: [] })
    expect(capGoalEventsToScore(0, 1, [45], [{ minute: 45, side: 'away' }]).goalMinutes).toEqual([45])
  })
  it('normalizes Chinese handicap and quarter total lines', () => {
    expect(parseAsianLine('半/一')).toBe(0.75)
    expect(parseAsianLine("<font color='red'>*</font>平/半")).toBe(-0.25)
    expect(parseTotalLine('2.5/3')).toBe(2.75)
  })
  it('counts each team recent 20 matches with a first-half goal', () => {
    const rows = Array.from({ length: 24 }, (_, index) => `a[${index}]=[${index},'联赛','#fff','26-01-01','主','客',${index % 2 ? 1 : 3},${index % 2 ? 4 : 2},1,0,${index % 3 ? 1 : 0},0,0,0,0,2];`).join('\n')
    const history = parseHalfGoalHistory(`var hometeamid=1,guestteamid=2,sclass='联赛';\n${rows}`)
    expect(history?.home.sample).toBe(12)
    expect(history?.away.sample).toBe(12)
    expect(history?.home.withGoal).toBe(8)
    expect(history?.away.withGoal).toBe(8)
  })
  it('parses live detail events, assists and technical statistics without evaluating source code', () => {
    const source = `var d_f=new Object();d_f[9]=[[1,6,10,1,2,1,'射手^Scorer','助攻者^Assist',0,'',''],[3,27,11,3,0,2,'客队球员^Away','',0,'','']];var tT_f=new Object();tT_f[9]=[[4,'6','8',43,57],[5,'4','3',57,43],[11,'45%','55%',45,55]];`
    const detail = parseMatchDetail(source, 9)
    expect(detail.events[0]).toMatchObject({ label: '进球', minute: 6, side: 'home', player: '射手', assist: '助攻者' })
    expect(detail.events[1]).toMatchObject({ label: '黄牌', side: 'away' })
    expect(detail.stats).toEqual(expect.arrayContaining([expect.objectContaining({ label: '射门', home: '6', away: '8' }), expect.objectContaining({ label: '控球率' })]))
  })
})
