package vstore

import (
	"context"
	"strings"

	"github.com/valkey-io/valkey-go"
)

// NewClient connects to Valkey with client-side caching disabled.
// Accepts either a full redis:// URL (rediss:// enables TLS, user:password
// enables auth — used for cloud hosting) or a plain host:port address.
func NewClient(addrOrURL string) (valkey.Client, error) {
	addrOrURL = strings.TrimSpace(addrOrURL)
	if strings.Contains(addrOrURL, "://") {
		opt, err := valkey.ParseURL(addrOrURL)
		if err != nil {
			return nil, err
		}
		opt.DisableCache = true
		return valkey.NewClient(opt)
	}
	if addrOrURL == "" {
		addrOrURL = "localhost:6379"
	}
	return valkey.NewClient(valkey.ClientOption{
		InitAddress:  []string{addrOrURL},
		DisableCache: true,
	})
}

// Get fetches a string key; returns ("", false, nil) on cache miss.
func Get(ctx context.Context, c valkey.Client, key string) (string, bool, error) {
	if c == nil {
		return "", false, nil
	}
	s, err := c.Do(ctx, c.B().Arbitrary("GET").Keys(key).Build()).ToString()
	if err != nil {
		if valkey.IsValkeyNil(err) {
			return "", false, nil
		}
		return "", false, err
	}
	return s, true, nil
}

// SetEX sets key with TTL in seconds; no-op when client is nil.
func SetEX(ctx context.Context, c valkey.Client, key, value string, seconds int64) error {
	if c == nil {
		return nil
	}
	secs := "300"
	if seconds > 0 {
		itoa := func(n int64) string {
			if n == 0 {
				return "0"
			}
			var buf [24]byte
			i := len(buf)
			for n > 0 {
				i--
				buf[i] = byte('0' + n%10)
				n /= 10
			}
			return string(buf[i:])
		}
		secs = itoa(seconds)
	}
	return c.Do(ctx, c.B().Arbitrary("SETEX").Keys(key).Args(secs, value).Build()).Error()
}

// ZIncrBy increments a ZSET member's score; ignores nil client.
func ZIncrBy(ctx context.Context, c valkey.Client, key, member string, delta float64) error {
	if c == nil {
		return nil
	}
	return c.Do(ctx, c.B().Arbitrary("ZINCRBY").Keys(key).Args(ftoa(delta), member).Build()).Error()
}

// ZRevRangeWithScores returns members highest-score-first with scores.
func ZRevRangeWithScores(ctx context.Context, c valkey.Client, key string, start, stop int64) ([]string, []float64, error) {
	if c == nil {
		return nil, nil, errNilClient
	}
	vals, err := c.Do(ctx, c.B().Arbitrary("ZREVRANGE").Keys(key).Args(itoa(start), itoa(stop), "WITHSCORES").Build()).ToArray()
	if err != nil {
		return nil, nil, err
	}
	var members []string
	var scores []float64
	for i := 0; i+1 < len(vals); i += 2 {
		m, merr := vals[i].ToString()
		if merr != nil {
			continue
		}
		s, serr := vals[i+1].ToFloat64()
		if serr != nil {
			continue
		}
		members = append(members, m)
		scores = append(scores, s)
	}
	return members, scores, nil
}

// Publish sends a message to a Pub/Sub channel; ignores nil client.
func Publish(ctx context.Context, c valkey.Client, channel, message string) error {
	if c == nil {
		return nil
	}
	return c.Do(ctx, c.B().Arbitrary("PUBLISH").Keys(channel).Args(message).Build()).Error()
}

// Incr atomically increments a string counter; ignores nil client.
func Incr(ctx context.Context, c valkey.Client, key string) error {
	if c == nil {
		return nil
	}
	return c.Do(ctx, c.B().Arbitrary("INCR").Keys(key).Build()).Error()
}

// Del removes keys; ignores nil client.
func Del(ctx context.Context, c valkey.Client, keys ...string) error {
	if c == nil || len(keys) == 0 {
		return nil
	}
	return c.Do(ctx, c.B().Arbitrary("DEL").Keys(keys...).Build()).Error()
}

// Expire sets a TTL in seconds on a key; ignores nil client.
func Expire(ctx context.Context, c valkey.Client, key string, seconds int64) error {
	if c == nil {
		return nil
	}
	return c.Do(ctx, c.B().Arbitrary("EXPIRE").Keys(key).Args(itoa(seconds)).Build()).Error()
}

// TimelinePush adds a tweet ID to a follower timeline ZSET (score = tweet ID
// so Snowflake time-ordering is preserved) and trims it to 1000 entries.
func TimelinePush(ctx context.Context, c valkey.Client, key string, tweetID int64) error {
	if c == nil {
		return nil
	}
	id := itoa(tweetID)
	if err := c.Do(ctx, c.B().Arbitrary("ZADD").Keys(key).Args(id, id).Build()).Error(); err != nil {
		return err
	}
	return c.Do(ctx, c.B().Arbitrary("ZREMRANGEBYRANK").Keys(key).Args("0", "-1001").Build()).Error()
}

var errNilClient = errSentinel{}

type errSentinel struct{}

func (errSentinel) Error() string { return "valkey client is nil" }

func itoa(n int64) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [24]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

func ftoa(f float64) string {
	neg := false
	if f < 0 {
		neg = true
		f = -f
	}
	intPart := int64(f)
	frac := int64((f-float64(intPart))*1000 + 0.5)
	s := itoa(intPart)
	if frac > 0 {
		// Trim trailing zeros.
		for frac%10 == 0 {
			frac /= 10
		}
		s += "." + itoa(frac)
		_ = frac
	}
	if neg {
		s = "-" + s
	}
	return s
}
func ZAdd(ctx context.Context, c valkey.Client, key string, members map[string]float64) error {
	if c == nil || len(members) == 0 {
		return nil
	}
	floatToString := func(f float64) string {
		// Enough precision for trend scores.
		s := ""
		neg := false
		if f < 0 {
			neg = true
			f = -f
		}
		intPart := int64(f)
		var buf [32]byte
		i := len(buf)
		if intPart == 0 {
			i--
			buf[i] = '0'
		} else {
			for intPart > 0 {
				i--
				buf[i] = byte('0' + intPart%10)
				intPart /= 10
			}
		}
		s = string(buf[i:])
		if neg {
			s = "-" + s
		}
		return s
	}
	args := make([]string, 0, len(members)*2)
	for m, score := range members {
		args = append(args, floatToString(score), m)
	}
	return c.Do(ctx, c.B().Arbitrary("ZADD").Keys(key).Args(args...).Build()).Error()
}
