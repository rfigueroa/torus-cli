// Package session provides in-memory storage of secure session details.
package session

import (
	"errors"
	"fmt"
	"sync"

	"github.com/manifoldco/torus-cli/apitypes"
	"github.com/manifoldco/torus-cli/base64"
	"github.com/manifoldco/torus-cli/envelope"
	"github.com/manifoldco/torus-cli/identity"
	"github.com/manifoldco/torus-cli/primitive"
)

// A session can represent either a machine or a user
const (
	MachineSession = "machine"
	UserSession    = "user"
	NotLoggedIn    = "no_session"
)

const notLoggedInError = "Please login to perform that command"

type session struct {
	mutex       *sync.Mutex
	sessionType string
	identity    *envelope.Unsigned
	auth        *envelope.Unsigned

	// sensitive values
	token      string
	passphrase string
}

// Session is the interface for access to secure session details.
type Session interface {
	Type() string
	Set(string, *envelope.Unsigned, *envelope.Unsigned, string, string) error
	ID() *identity.ID
	AuthID() *identity.ID
	Token() string
	Passphrase() string
	MasterKey() (*base64.Value, error)
	HasToken() bool
	HasPassphrase() bool
	Logout() error
	String() string
}

// NewSession returns the default implementation of the Session interface
// for a user or machine depending on the passed type.
func NewSession() Session {
	return &session{mutex: &sync.Mutex{}, sessionType: NotLoggedIn}
}

// Type returns the type of identity this session represents (e.g. user or
// machine)
func (s *session) Type() string {
	return s.sessionType
}

// ID returns the ID representing the Identity providing object (e.g. user or
// machine)
func (s *session) ID() *identity.ID {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	if s.identity == nil {
		return nil
	}

	return s.identity.ID
}

// AuthID returns the ID representing the object used for authorization (e.g.
// user or machine token).
func (s *session) AuthID() *identity.ID {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	if s.auth == nil {
		return nil
	}

	return s.auth.ID
}

// Token returns the auth token stored in this session.
func (s *session) Token() string {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	return s.token
}

// Passphrase returns the user's passphrase.
func (s *session) Passphrase() string {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	return s.passphrase
}

func (s *session) HasToken() bool {
	return (len(s.token) > 0)
}

func (s *session) HasPassphrase() bool {
	return (len(s.passphrase) > 0)
}

// String implements the fmt.Stringer interface.
func (s *session) String() string {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	return fmt.Sprintf("Session{type:%s,token:%t,passphrase:%t}",
		s.Type(), s.HasToken(), s.HasPassphrase())
}

// Set atomically sets all relevant session details.
//
// It returns an error if any values are empty.
func (s *session) Set(sessionType string, identity, auth *envelope.Unsigned,
	passphrase, token string) error {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	if s.Type() != NotLoggedIn {
		return errors.New("Cannot overwrite existing session")
	}

	if identity == nil || auth == nil {
		return errors.New("identity and auth cannot be null")
	}

	switch sessionType {
	case UserSession:
		if _, ok := identity.Body.(*primitive.User); !ok {
			return errors.New("Identity must be a user object")
		}

		if _, ok := auth.Body.(*primitive.User); !ok {
			return errors.New("Auth must be a user object")
		}
	case MachineSession:
		if _, ok := identity.Body.(*primitive.Machine); !ok {
			return errors.New("Identity must be machine object")
		}

		if _, ok := auth.Body.(*primitive.MachineToken); !ok {
			return errors.New("Auth must be a machine token object")
		}
	default:
		panic("did not recognize session type")
	}

	if len(passphrase) == 0 {
		return errors.New("Passphrase must not be empty")
	}

	if len(token) == 0 {
		return errors.New("Token must not be empty")
	}

	s.sessionType = sessionType
	s.passphrase = passphrase
	s.token = token
	s.identity = identity
	s.auth = auth

	return nil
}

func createNotLoggedInError() error {
	return &apitypes.Error{
		Type: apitypes.UnauthorizedError,
		Err:  []string{notLoggedInError},
	}
}

// Returns the base64 representation of the identities encrypted master key
func (s *session) MasterKey() (*base64.Value, error) {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	if s.Type() == NotLoggedIn {
		return nil, createNotLoggedInError()
	}

	if s.Type() == UserSession {
		return s.auth.Body.(*primitive.User).Master.Value, nil
	}

	return s.auth.Body.(*primitive.MachineToken).Master.Value, nil
}

// Logout resets all values to the logged out state
func (s *session) Logout() error {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	if s.Type() == NotLoggedIn {
		return createNotLoggedInError()
	}

	s.sessionType = NotLoggedIn
	s.identity = nil
	s.auth = nil
	s.token = ""
	s.passphrase = ""
	return nil
}
