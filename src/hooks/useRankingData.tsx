// Backward-compatible name for the single audited ranking source. Keeping this
// alias prevents future callers from reintroducing the legacy client-side
// calculation that included pending/rejected sales and truncated Data API rows.
export {
  useRankingDataWithMock as useRankingData,
  type RankingUser,
} from './useRankingDataWithMock'
