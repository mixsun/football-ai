export interface Triple { left: number | null; line: number | null; right: number | null }
export interface Market { opening: Triple; current: Triple }
export interface Markets { asian: Market; liveAsian?: Market; europe: Market; total: Market; halfAsian: Market; halfTotal: Market; halfEurope: Market }
export type GoalSide = 'home' | 'away' | 'unknown'
export interface GoalEvent { minute: number; side: GoalSide }
export interface MatchDetailEvent { kind: number; label: string; minute: number; extraMinute: number; side: 'home' | 'away'; player: string; assist: string; note: string }
export interface MatchDetailStatistic { kind: number; label: string; home: string; away: string; homePercent: number; awayPercent: number }
export interface MatchDetailResponse { fetchedAt: string; source: string; events: MatchDetailEvent[]; stats: MatchDetailStatistic[] }
export interface TeamHalfHistory { sample: number; withGoal: number }
export interface HalfGoalHistory { home: TeamHalfHistory; away: TeamHalfHistory }
export interface LiveMatch {
  id: number; league: string; home: string; away: string; scheduledAt: string; actualStart: string | null
  state: number; minute: number | null; homeScore: number; awayScore: number; homeHalfScore: number; awayHalfScore: number
  goalMinutes: number[]; goalEvents?: GoalEvent[]; halfGoalHistory?: HalfGoalHistory; markets: Markets | null; sameMarketCount: number
}
export interface LiveResponse { fetchedAt: string; source: string; matches: LiveMatch[] }
export type RiskLevel = 'done' | 'high' | 'medium' | 'watch' | 'low' | 'unavailable'
export type RuleStatus = 'match' | 'miss' | 'unknown'
export interface RuleEvidence { code: string; label: string; status: RuleStatus; details: string[] }
export interface Analysis { probability: number | null; level: RiskLevel; label: string; reason: string; signals: string[]; rules: RuleEvidence[] }
