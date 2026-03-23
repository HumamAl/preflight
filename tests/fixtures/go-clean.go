// Expected findings: 0 (this file should pass preflight cleanly)
//
// This file demonstrates well-written Go with proper error handling, context
// propagation, defer patterns, correct use of io (not ioutil), and standard
// library best practices. Preflight should NOT flag anything here.

package cache

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"sync"
	"time"
)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Entry represents a single cached value with expiration metadata.
type Entry struct {
	Key       string    `json:"key"`
	Value     []byte    `json:"value"`
	CreatedAt time.Time `json:"created_at"`
	ExpiresAt time.Time `json:"expires_at"`
	HitCount  int64     `json:"hit_count"`
}

// Expired reports whether the entry has passed its expiration time.
func (e *Entry) Expired() bool {
	return time.Now().After(e.ExpiresAt)
}

// Stats holds aggregate statistics for the cache.
type Stats struct {
	Entries  int   `json:"entries"`
	Hits     int64 `json:"hits"`
	Misses   int64 `json:"misses"`
	Evicted  int64 `json:"evicted"`
}

// HitRate returns the cache hit ratio as a value between 0 and 1.
// Returns 0 if no lookups have been performed.
func (s Stats) HitRate() float64 {
	total := s.Hits + s.Misses
	if total == 0 {
		return 0
	}
	return float64(s.Hits) / float64(total)
}

// ---------------------------------------------------------------------------
// Cache implementation
// ---------------------------------------------------------------------------

// Cache is a concurrency-safe in-memory key-value cache with TTL support.
type Cache struct {
	mu      sync.RWMutex
	entries map[string]*Entry
	stats   Stats
	ttl     time.Duration
	logger  *slog.Logger
}

// New creates a Cache with the given default TTL and logger.
func New(ttl time.Duration, logger *slog.Logger) *Cache {
	return &Cache{
		entries: make(map[string]*Entry),
		ttl:     ttl,
		logger:  logger,
	}
}

// Get retrieves an entry by key. Returns the value and true if found and not
// expired, or nil and false otherwise.
func (c *Cache) Get(key string) ([]byte, bool) {
	c.mu.RLock()
	entry, ok := c.entries[key]
	c.mu.RUnlock()

	if !ok {
		c.mu.Lock()
		c.stats.Misses++
		c.mu.Unlock()
		return nil, false
	}

	if entry.Expired() {
		c.mu.Lock()
		delete(c.entries, key)
		c.stats.Evicted++
		c.stats.Misses++
		c.mu.Unlock()
		return nil, false
	}

	c.mu.Lock()
	entry.HitCount++
	c.stats.Hits++
	c.mu.Unlock()

	return entry.Value, true
}

// Set stores a value under the given key with the cache's default TTL.
func (c *Cache) Set(key string, value []byte) {
	now := time.Now()
	c.mu.Lock()
	c.entries[key] = &Entry{
		Key:       key,
		Value:     value,
		CreatedAt: now,
		ExpiresAt: now.Add(c.ttl),
	}
	c.stats.Entries = len(c.entries)
	c.mu.Unlock()
}

// Delete removes an entry by key. Returns true if the key existed.
func (c *Cache) Delete(key string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, ok := c.entries[key]; !ok {
		return false
	}
	delete(c.entries, key)
	c.stats.Entries = len(c.entries)
	return true
}

// Purge removes all expired entries and returns the count of evicted items.
func (c *Cache) Purge() int64 {
	c.mu.Lock()
	defer c.mu.Unlock()

	var evicted int64
	for key, entry := range c.entries {
		if entry.Expired() {
			delete(c.entries, key)
			evicted++
		}
	}

	c.stats.Evicted += evicted
	c.stats.Entries = len(c.entries)
	c.logger.Info("purge complete", "evicted", evicted, "remaining", c.stats.Entries)
	return evicted
}

// Snapshot returns a copy of the current cache statistics.
func (c *Cache) Snapshot() Stats {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.stats
}

// ---------------------------------------------------------------------------
// Background eviction
// ---------------------------------------------------------------------------

// StartEvictor launches a background goroutine that runs Purge at the given
// interval. It respects context cancellation for clean shutdown.
func (c *Cache) StartEvictor(ctx context.Context, interval time.Duration) {
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				c.logger.Info("evictor stopped", "reason", ctx.Err())
				return
			case <-ticker.C:
				evicted := c.Purge()
				if evicted > 0 {
					c.logger.Debug("evictor cycle", "evicted", evicted)
				}
			}
		}
	}()
}

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------

// Handler exposes the cache over HTTP with GET (lookup), PUT (store), and
// DELETE (remove) methods. It reads the key from the URL path and the value
// from the request body.
func (c *Cache) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := r.URL.Path
		if key == "" || key == "/" {
			writeJSON(w, http.StatusBadRequest, map[string]string{
				"error": "key is required in the URL path",
			})
			return
		}

		switch r.Method {
		case http.MethodGet:
			c.handleGet(w, key)
		case http.MethodPut:
			c.handlePut(w, r, key)
		case http.MethodDelete:
			c.handleDelete(w, key)
		default:
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{
				"error": fmt.Sprintf("method %s not allowed", r.Method),
			})
		}
	})
}

func (c *Cache) handleGet(w http.ResponseWriter, key string) {
	value, ok := c.Get(key)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{
			"error": "key not found or expired",
		})
		return
	}

	w.Header().Set("Content-Type", "application/octet-stream")
	w.WriteHeader(http.StatusOK)
	if _, err := w.Write(value); err != nil {
		c.logger.Error("failed to write response", "key", key, "error", err)
	}
}

func (c *Cache) handlePut(w http.ResponseWriter, r *http.Request, key string) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20)) // 1 MiB limit
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": fmt.Sprintf("failed to read body: %v", err),
		})
		return
	}
	defer r.Body.Close()

	if len(body) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "request body must not be empty",
		})
		return
	}

	c.Set(key, body)
	writeJSON(w, http.StatusCreated, map[string]string{
		"message": "stored",
		"key":     key,
	})
}

func (c *Cache) handleDelete(w http.ResponseWriter, key string) {
	if !c.Delete(key) {
		writeJSON(w, http.StatusNotFound, map[string]string{
			"error": "key not found",
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"message": "deleted",
		"key":     key,
	})
}

// ---------------------------------------------------------------------------
// Serialization (for persistence)
// ---------------------------------------------------------------------------

// ExportTo writes the current cache contents to w as JSON. Expired entries are
// excluded. The caller is responsible for closing w.
func (c *Cache) ExportTo(ctx context.Context, w io.Writer) error {
	c.mu.RLock()
	defer c.mu.RUnlock()

	select {
	case <-ctx.Done():
		return fmt.Errorf("export cancelled: %w", ctx.Err())
	default:
	}

	live := make([]*Entry, 0, len(c.entries))
	for _, entry := range c.entries {
		if !entry.Expired() {
			live = append(live, entry)
		}
	}

	if err := json.NewEncoder(w).Encode(live); err != nil {
		return fmt.Errorf("encode cache entries: %w", err)
	}

	return nil
}

// ImportFrom reads JSON-encoded cache entries from r and loads them into the
// cache, skipping any that are already expired.
func (c *Cache) ImportFrom(ctx context.Context, r io.Reader) (int, error) {
	select {
	case <-ctx.Done():
		return 0, fmt.Errorf("import cancelled: %w", ctx.Err())
	default:
	}

	data, err := io.ReadAll(r)
	if err != nil {
		return 0, fmt.Errorf("read import data: %w", err)
	}

	var entries []*Entry
	if err := json.Unmarshal(data, &entries); err != nil {
		return 0, fmt.Errorf("decode import data: %w", err)
	}

	loaded := 0
	c.mu.Lock()
	defer c.mu.Unlock()

	for _, entry := range entries {
		if entry.Expired() {
			continue
		}
		c.entries[entry.Key] = entry
		loaded++
	}

	c.stats.Entries = len(c.entries)
	c.logger.Info("import complete", "loaded", loaded, "skipped_expired", len(entries)-loaded)
	return loaded, nil
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Default().Error("failed to write JSON response", "error", err)
	}
}

// Sentinel errors for callers to match with errors.Is.
var (
	ErrKeyNotFound = errors.New("cache: key not found")
	ErrKeyExpired  = errors.New("cache: key expired")
)
