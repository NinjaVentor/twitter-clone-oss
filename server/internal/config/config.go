package config

import (
	"os"
	"strings"
)

type Config struct {
	Port                   string
	FrontendURL            string
	DatabaseURL            string
	SupabaseURL            string
	SupabaseAnonKey        string
	SupabaseServiceRoleKey string
	SupabaseJWTSecret      string
	ValkeyAddr             string
	// ValkeyURL is the raw redis:// URL (may carry rediss:// TLS scheme and
	// user:password credentials for cloud hosting). Takes precedence over ValkeyAddr.
	ValkeyURL string
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// Load reads environment (optionally from .env handled by caller) into Config.
// VALKEY_URL (full redis:// URL incl. rediss TLS + credentials) takes
// precedence; VALKEY_ADDR (plain host:port) is the local fallback.
func Load() Config {
	valkeyURL := cleanEnvURL(os.Getenv("VALKEY_URL"))
	if valkeyURL == "" {
		valkeyURL = cleanEnvURL(os.Getenv("REDIS_URL"))
	}
	valkeyAddr := os.Getenv("VALKEY_ADDR")
	if valkeyAddr == "" {
		raw := os.Getenv("VALKEY_URL")
		if raw == "" {
			raw = os.Getenv("REDIS_URL")
		}
		valkeyAddr = parseRedisURL(raw)
	}
	if valkeyAddr == "" {
		valkeyAddr = "localhost:6379"
	}
	return Config{
		Port:                   getenv("PORT", "8080"),
		FrontendURL:            strings.TrimRight(os.Getenv("FRONTEND_URL"), "/"),
		DatabaseURL:            os.Getenv("DATABASE_URL"),
		SupabaseURL:            strings.TrimRight(os.Getenv("SUPABASE_URL"), "/"),
		SupabaseAnonKey:        os.Getenv("SUPABASE_ANON_KEY"),
		SupabaseServiceRoleKey: os.Getenv("SUPABASE_SERVICE_ROLE_KEY"),
		SupabaseJWTSecret:      os.Getenv("SUPABASE_JWT_SECRET"),
		ValkeyAddr:             valkeyAddr,
		ValkeyURL:              valkeyURL,
	}
}

// cleanEnvURL trims whitespace and stray surrounding quotes from a URL value.
func cleanEnvURL(raw string) string {
	s := strings.TrimSpace(raw)
	s = strings.Trim(s, `"'`)
	return strings.TrimSpace(s)
}

func parseRedisURL(raw string) string {
	if raw == "" {
		return ""
	}
	s := strings.TrimSpace(raw)
	s = strings.TrimPrefix(s, "redis://")
	s = strings.TrimPrefix(s, "rediss://")
	s = strings.TrimPrefix(s, "valkey://")
	// Strip credentials user:pass@
	if at := strings.LastIndex(s, "@"); at != -1 {
		s = s[at+1:]
	}
	// Strip trailing db number / query: host:port/0?x=y
	if i := strings.Index(s, "/"); i != -1 {
		s = s[:i]
	}
	if s == "" {
		return ""
	}
	if !strings.Contains(s, ":") {
		s += ":6379"
	}
	return s
}
