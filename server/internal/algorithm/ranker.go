package algorithm

import (
	"math"
	"sort"
	"time"

	"twitter-server/internal/models"
)

// ScoredTweet pairs a hydrated tweet with its recommendation score.
type ScoredTweet struct {
	Tweet models.HydratedTweet
	Score float64
}

// ScoreTweet implements the For You scoring formula.
func ScoreTweet(
	t models.HydratedTweet,
	viewerID int64,
	authorAffinity float64,
	matchingTagsAffinity float64,
	isFollowingAuthor bool,
	socialProofCount int,
	seen bool,
	now time.Time,
) float64 {
	engagementScore := 1.0 +
		float64(t.LikeCount)*1.0 +
		float64(t.RetweetCount)*2.5 +
		float64(t.QuoteCount)*3.0 +
		float64(t.BookmarkCount)*3.0 +
		float64(t.ReplyCount)*4.5 +
		math.Log10(1.0+float64(t.ViewCount))*0.5

	authorBoost := math.Min(3.0, authorAffinity*0.25)
	topicBoost := math.Min(2.5, matchingTagsAffinity*0.35)

	followBoost := 0.0
	if isFollowingAuthor {
		followBoost = 1.4
	}
	socialProofBoost := math.Min(2.0, float64(socialProofCount)*0.8)
	personalizationMultiplier := 1.0 + followBoost + authorBoost + topicBoost + socialProofBoost

	mediaMultiplier := 1.0
	if len(t.MediaURLs) > 0 || t.PollData != nil {
		mediaMultiplier = 1.2
	}

	freshOwnTweetBoost := 1.0
	if t.UserID == viewerID && now.Sub(t.CreatedAt) < 15*time.Minute {
		freshOwnTweetBoost = 2.5
	}

	seenPenalty := 1.0
	freshOwn := t.UserID == viewerID && now.Sub(t.CreatedAt) < 5*time.Minute
	if seen && !freshOwn {
		seenPenalty = 0.38
	}

	ageHours := math.Max(0.1, now.Sub(t.CreatedAt).Hours())
	timeDecay := math.Pow(ageHours+2.0, 1.35)

	return (engagementScore * personalizationMultiplier * mediaMultiplier * freshOwnTweetBoost * seenPenalty) / timeDecay
}

// RankScores sorts by score DESC, applies the author-diversity pass (the
// k-th tweet from the same author keeps math.Pow(0.6, k-1) of its score),
// then re-sorts so no single author dominates consecutive slots.
func RankScores(scored []ScoredTweet) []ScoredTweet {
	sort.SliceStable(scored, func(i, j int) bool { return scored[i].Score > scored[j].Score })
	seenAuthor := map[int64]int{}
	for i := range scored {
		author := scored[i].Tweet.UserID
		seenAuthor[author]++
		if seenAuthor[author] > 1 {
			scored[i].Score *= math.Pow(0.6, float64(seenAuthor[author]-1))
		}
	}
	sort.SliceStable(scored, func(i, j int) bool { return scored[i].Score > scored[j].Score })
	return scored
}

// Paginate slices a ranked list deterministically: offset selects the
// window, nextOffset is -1 when exhausted. Infinite scroll never duplicates.
func Paginate[T any](ranked []T, offset, limit int) (page []T, nextOffset int) {
	if offset < 0 {
		offset = 0
	}
	if offset >= len(ranked) {
		return []T{}, -1
	}
	end := offset + limit
	if end >= len(ranked) {
		return ranked[offset:], -1
	}
	return ranked[offset:end], end
}
