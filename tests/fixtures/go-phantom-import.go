// Expected findings: 3
//
// This file contains three intentional issues:
//   1. PHANTOM_PACKAGE: import of "github.com/gorilla/sessions-v2" which does
//      not exist -- the real package is "github.com/gorilla/sessions"
//   2. DEPRECATED_API: use of ioutil.ReadAll (deprecated since Go 1.16; use
//      io.ReadAll instead)
//   3. UNCHECKED_ERROR: json.NewEncoder(w).Encode(resp) returns an error that
//      is silently discarded
//
// NOTE: These bugs are INTENTIONAL test fixtures for the preflight plugin.

package middleware

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"net/http"
	"time"

	"github.com/gorilla/sessions-v2" // PHANTOM: real package is "github.com/gorilla/sessions"
)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// SessionConfig holds the configuration for the session middleware.
type SessionConfig struct {
	StoreName  string
	CookieName string
	MaxAge     int
	Secure     bool
	HTTPOnly   bool
	SameSite   http.SameSite
}

// DefaultSessionConfig returns a production-ready session configuration.
func DefaultSessionConfig() SessionConfig {
	return SessionConfig{
		StoreName:  "app-sessions",
		CookieName: "session_id",
		MaxAge:     86400,
		Secure:     true,
		HTTPOnly:   true,
		SameSite:   http.SameSiteStrictMode,
	}
}

// UserSession represents the data stored in a user's session.
type UserSession struct {
	UserID    string    `json:"user_id"`
	Email     string    `json:"email"`
	Role      string    `json:"role"`
	CreatedAt time.Time `json:"created_at"`
	ExpiresAt time.Time `json:"expires_at"`
}

// ErrorResponse is the JSON structure for error responses.
type ErrorResponse struct {
	Error   string `json:"error"`
	Code    int    `json:"code"`
	TraceID string `json:"trace_id,omitempty"`
}

// ---------------------------------------------------------------------------
// Session store
// ---------------------------------------------------------------------------

var store *sessions.CookieStore

// InitStore initializes the cookie-backed session store.
func InitStore(secret []byte) {
	store = sessions.NewCookieStore(secret)
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

// ProfileHandler returns the current user's profile from their session.
// It reads the request body to check for an optional "fields" filter.
func ProfileHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "only POST is accepted")
		return
	}

	session, err := store.Get(r, "app-sessions")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to retrieve session")
		return
	}

	userID, ok := session.Values["user_id"].(string)
	if !ok || userID == "" {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}

	// BUG: ioutil.ReadAll is deprecated since Go 1.16.
	// Should use io.ReadAll instead.
	body, err := ioutil.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to read request body")
		return
	}
	defer r.Body.Close()

	var filter struct {
		Fields []string `json:"fields"`
	}
	if len(body) > 0 {
		if err := json.Unmarshal(body, &filter); err != nil {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid JSON: %v", err))
			return
		}
	}

	email, _ := session.Values["email"].(string)
	role, _ := session.Values["role"].(string)

	resp := UserSession{
		UserID:    userID,
		Email:     email,
		Role:      role,
		CreatedAt: time.Now().Add(-24 * time.Hour),
		ExpiresAt: time.Now().Add(24 * time.Hour),
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)

	// BUG: Encode returns an error that is silently discarded.
	// Should be: if err := json.NewEncoder(w).Encode(resp); err != nil { ... }
	json.NewEncoder(w).Encode(resp)
}

// LoginHandler authenticates a user and stores their data in the session.
func LoginHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "only POST is accepted")
		return
	}

	var creds struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}

	if err := json.NewDecoder(r.Body).Decode(&creds); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	defer r.Body.Close()

	if creds.Email == "" || creds.Password == "" {
		writeError(w, http.StatusBadRequest, "email and password are required")
		return
	}

	// Simulate authentication (in production this would query a database)
	userID := fmt.Sprintf("user_%x", time.Now().UnixNano())

	session, err := store.Get(r, "app-sessions")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create session")
		return
	}

	session.Values["user_id"] = userID
	session.Values["email"] = creds.Email
	session.Values["role"] = "member"

	if err := session.Save(r, w); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save session")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)

	resp := map[string]string{
		"message": "authenticated",
		"user_id": userID,
	}
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		log.Printf("failed to encode login response: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func writeError(w http.ResponseWriter, code int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)

	resp := ErrorResponse{
		Error: message,
		Code:  code,
	}
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		log.Printf("failed to encode error response: %v", err)
	}
}
