package storage

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const mediaBucket = "media"

var httpClient = &http.Client{Timeout: 15 * time.Second}

// ObjectPathsFromURLs extracts Supabase Storage object paths (within the
// `media` bucket) from a list of URLs. Only URLs hosted under supabaseURL
// are considered, so external avatars (Google, etc.) are never touched.
// Supports both /storage/v1/object/public/media/<path> and
// /storage/v1/object/media/<path> forms.
func ObjectPathsFromURLs(supabaseURL string, urls []string) []string {
	base := strings.TrimRight(supabaseURL, "/")
	if base == "" {
		return nil
	}
	var out []string
	for _, u := range urls {
		u = strings.TrimSpace(u)
		if u == "" || !strings.HasPrefix(u, base+"/storage/v1/object/") {
			continue
		}
		rest := strings.TrimPrefix(u, base+"/storage/v1/object/")
		// Strip query strings (?token=...) that signed URLs may carry.
		if i := strings.Index(rest, "?"); i != -1 {
			rest = rest[:i]
		}
		parts := strings.Split(rest, "/")
		// [public|authenticated|... bucket path...] or [bucket path...]
		if len(parts) < 2 {
			continue
		}
		var bucket string
		var path string
		if len(parts) >= 3 && parts[1] == mediaBucket {
			bucket = parts[1]
			path = strings.Join(parts[2:], "/")
		} else if parts[0] == mediaBucket {
			bucket = parts[0]
			path = strings.Join(parts[1:], "/")
		} else {
			continue
		}
		path = strings.Trim(path, "/")
		if path == "" {
			continue
		}
		_ = bucket
		out = append(out, path)
	}
	return out
}

// DeleteObjects removes paths from the `media` bucket via
// DELETE {SUPABASE_URL}/storage/v1/object/media/<p1>,<p2>,...
// It authenticates with SUPABASE_SERVICE_ROLE_KEY, falling back to the
// caller's Bearer token (best effort when RLS permits).
func DeleteObjects(ctx context.Context, supabaseURL, serviceRoleKey, bearerToken string, paths []string) error {
	if len(paths) == 0 {
		return nil
	}
	base := strings.TrimRight(supabaseURL, "/")
	if base == "" {
		return fmt.Errorf("supabase url not configured")
	}
	key := serviceRoleKey
	if key == "" {
		key = bearerToken
	}
	if key == "" {
		return fmt.Errorf("no storage credentials available")
	}
	// Supabase bulk-deletes comma-joined object paths in one request.
	endpoint := base + "/storage/v1/object/" + mediaBucket + "/" + strings.Join(paths, ",")
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, endpoint, nil)
	if err != nil {
		return err
	}
	req.Header.Set("apikey", key)
	req.Header.Set("Authorization", "Bearer "+key)
	resp, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("storage delete returned %s", resp.Status)
	}
	return nil
}

// DeleteAuthUser removes the Supabase Auth user via the admin API. Requires
// the service_role key; returns an error otherwise (caller treats as best effort).
func DeleteAuthUser(ctx context.Context, supabaseURL, serviceRoleKey, authID string) error {
	base := strings.TrimRight(supabaseURL, "/")
	if base == "" || serviceRoleKey == "" || authID == "" {
		return fmt.Errorf("auth admin delete not configured")
	}
	endpoint := base + "/auth/v1/admin/users/" + authID
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, endpoint, nil)
	if err != nil {
		return err
	}
	req.Header.Set("apikey", serviceRoleKey)
	req.Header.Set("Authorization", "Bearer "+serviceRoleKey)
	resp, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("auth admin delete returned %s", resp.Status)
	}
	return nil
}
