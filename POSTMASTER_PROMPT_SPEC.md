# Postmaster Prompt Integration Spec

Use this document as a copy/paste context block when asking an AI assistant to build a game or app that uses Postmaster.

## Copy/Paste Prompt Block

```text
You are integrating with the Postmaster Messaging API.

Goal:
- Build application features using Postmaster as the session + message backend.
- Do not invent endpoints or fields; use only what is defined here.

Base URL:
- Use ${POSTMASTER_BASE_URL} (example: http://localhost:8000).

Authentication:
- Admin routes require header: X-Admin-Key: ${POSTMASTER_ADMIN_API_KEY}
- Non-admin application routes do not require auth (current version).

Application ID rules:
- application_id must match: ^[A-Za-z0-9_-]{1,64}$
- Create the application once before creating sessions.

Session ID format:
- Returned by API as short human-friendly code like "rocket-7Q2M".
- Treat session_id as opaque string; do not validate format in client.

Canonical flow:
1) Create application (admin, one-time)
2) Initialize session (no first message) OR create session with first message
3) Append messages/events to session
4) Read session history or last message

Endpoints:
1. POST /admin/applications
   Headers: Content-Type: application/json, X-Admin-Key: <key>
   Body: { "application_id": "chatbot" }
   201: { "application_id": "chatbot", "created_at": "<iso8601>" }
   Errors: 400 invalid application_id, 401 invalid admin key, 409 exists, 500 server misconfigured

2. GET /admin/applications/{application_id}
   Headers: X-Admin-Key: <key>
   200: { "application_id": "chatbot", "created_at": "<iso8601>" }
   Errors: 400, 401, 404

3. POST /applications/{application_id}/sessions/init
   201: { "application_id": "chatbot", "session_id": "rocket-7Q2M", "created_at": "<iso8601>" }
   Errors: 400 invalid application_id, 404 application not found

4. POST /applications/{application_id}/sessions
   Body: { "username": "alice", "message": "hello" }
   201: { "application_id": "chatbot", "session_id": "rocket-7Q2M", "username": "alice", "message": "hello", "timestamp": "<iso8601>" }
   Field limits: username 1..128 chars, message 1..10000 chars
   Errors: 400 validation/application_id, 404 application not found

5. GET /applications/{application_id}/sessions
   200: {
     "application_id": "chatbot",
     "sessions": [
       { "session_id": "rocket-7Q2M", "created_at": "<iso8601>", "message_count": 3 }
     ]
   }
   Errors: 400, 404

6. POST /applications/{application_id}/sessions/{session_id}/messages
   Body: { "username": "bob", "message": "move:e2e4" }
   201: { "application_id": "chatbot", "session_id": "rocket-7Q2M", "username": "bob", "message": "move:e2e4", "timestamp": "<iso8601>" }
   Errors: 400, 404 session/application not found

7. GET /applications/{application_id}/sessions/{session_id}
   200: {
     "application_id": "chatbot",
     "session_id": "rocket-7Q2M",
     "created_at": "<iso8601>",
     "messages": [
       { "username": "alice", "message": "hello", "timestamp": "<iso8601>" }
     ]
   }
   Errors: 400, 404

8. GET /applications/{application_id}/sessions/{session_id}/last
   200: { "application_id": "chatbot", "session_id": "rocket-7Q2M", "username": "bob", "message": "move:e2e4", "timestamp": "<iso8601>" }
   Errors: 400, 404 session missing/no messages

9. GET /health
   200: { "status": "ok" }

Implementation requirements:
- Always create/check the application first in environment setup.
- For multiplayer/game rooms, store domain events in "message" as string (for example JSON stringified events).
- Poll GET /sessions/{session_id} for full state reconstruction, or GET /last for lightweight updates.
- Handle 404 as "session/application does not exist"; do not auto-create silently.
- Persist and re-use returned session_id; never generate session IDs client-side.

Output requirements for generated code:
- Provide a Postmaster client module with typed methods for all endpoints used.
- Centralize base URL and admin key in config/env variables.
- Include retry with backoff for transient network failures (not for 4xx).
- Include clear error mapping for 400/401/404/409/500 responses.
```

## Recommended Usage Pattern For Games

- Create one `application_id` per product (for example `chess`, `tictactoe`, `quiz`).
- Create one `session_id` per game room/match.
- Encode game events as JSON strings in `message`, for example:
  - `{"type":"join","user":"alice"}`
  - `{"type":"move","user":"bob","move":"e2e4"}`
  - `{"type":"state","board":"..."}`
- Keep `username` as the actor for each event.

## Minimal Environment Variables

- `POSTMASTER_BASE_URL`
- `POSTMASTER_ADMIN_API_KEY` (needed only for admin routes)

