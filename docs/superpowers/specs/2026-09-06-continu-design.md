# continu Design Specification

> Secure, cross-AI context layer for Chromium browsers

**Goal:** Capture useful context from one AI conversation and move it to another without manual reconstruction.

**Product Name:** continu (not Capsule)

**Architecture:**
- Manifest V3 Chromium extension
- Popup primary UI, side panel for settings
- Background service worker for auth/sync orchestration
- Content scripts with adapter pattern for AI site integration
- Local-first storage (chrome.storage.local) with Supabase sync

**Tech Stack:**
- React 18 + TypeScript (popup/sidepanel)
- WXT (build system, Manifest V3, HMR)
- Clerk (@clerk/chrome-extension for auth)
- Supabase (Postgres + RLS)
- Zod (runtime validation)

## Core Actions

### Generate
Capture current AI conversation → normalize → create continu context → save locally immediately → sync to Supabase when authenticated and online.

**MUST NOT require AI provider. Works offline.**

Two modes:
- **Direct Generate**: Pure local extraction
- **Smart Generate**: Optional AI-assisted extraction (explicit user action only)

### Drop
Select context → detect active composer → format → insert text → user reviews and submits manually.

**NEVER auto-submit.**

Three output formats:
- **Structured** (default): Objective, state, decisions, requirements, constraints, questions, actions
- **Full**: Includes relevant conversation
- **Compact**: Essential continuation context only

### Cook This Prompt
Improve user's prompt via configured AI provider → preview → Replace/Copy/Cancel.

**Disabled without provider. Never auto-submit.**

## Context Schema

```typescript
interface ContinuContext {
  id: string; // UUID v4
  schemaVersion: number; // Versioned schema
  name: string;
  source: {
    platform: string; // chatgpt, claude, gemini, etc.
    url: string;
    title: string;
  };
  objective: string;
  currentState: string;
  decisions: string[];
  requirements: string[];
  constraints: string[];
  openQuestions: string[];
  nextActions: string[];
  conversation: ConversationTurn[];
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}
```

## Security Requirements (RELEASE BLOCKERS)

### Authentication
- Clerk via `@clerk/chrome-extension`
- `createClerkClient()` in background for token refresh
- Never put Clerk React provider in content scripts

### Database
- Supabase with native Clerk third-party auth integration
- RLS mandatory on all user-owned tables
- Use `auth.jwt()->>'sub'` for Clerk subject claim
- Never trust client-supplied user IDs

### Secrets (NEVER SHIP)
- Clerk secret key
- Supabase service-role key
- Supabase database password
- Application-wide AI API keys

### Content Scripts
- NO secrets in content scripts
- DOM access only for supported AI composers
- Validated message passing only

### Input Validation
- Zod validation at trust boundaries
- Max lengths on all string fields
- Max payload sizes
- Validate imported .continu files

### XSS Prevention
- No innerHTML with untrusted content
- Sanitize Markdown output
- AI output treated as untrusted

### SQL Injection
- Supabase query builders only
- Never concatenate SQL with user input

## Adapter Architecture

```
AdapterManager
├── ChatGPTAdapter
├── ClaudeAdapter
├── GeminiAdapter
├── PerplexityAdapter
├── MistralAdapter
├── DeepSeekAdapter
├── GrokAdapter
├── CopilotAdapter
└── GenericAdapter
```

**Base interface:**
- `detect(): boolean`
- `findComposer(): Element | null`
- `extractConversation(): ConversationTurn[]`
- `getComposerText(): string`
- `insertText(text: string): void`

**Detection strategy:**
1. Preferred selector
2. Fallback selector
3. Semantic detection
4. Generic adapter fallback

## Data Flow

```
┌─────────────────┐
│ Content Script  │──Adapter──→ Extract conversation
└─────────────────┘
        │
        ▼
┌─────────────────┐
│ Background SW   │──Validate──→ Zod schema
└─────────────────┘
        │
        ▼
┌─────────────────┐
│ Local Storage   │──chrome.storage.local──→ Immediate save
└─────────────────┘
        │
        ▼ (when authed + online)
┌─────────────────┐
│ Supabase        │──RLS──→ User-owned rows only
└─────────────────┘
```

## Database Schema

### profiles
```sql
CREATE TABLE profiles (
  clerk_user_id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### continu_contexts
```sql
CREATE TABLE continu_contexts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL REFERENCES profiles(clerk_user_id),
  name TEXT NOT NULL,
  source_platform TEXT,
  source_url TEXT,
  payload JSONB NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_contexts_user ON continu_contexts(clerk_user_id);
```

### RLS Policies
```sql
ALTER TABLE continu_contexts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own contexts"
  ON continu_contexts FOR SELECT
  USING (clerk_user_id = auth.jwt()->>'sub');

CREATE POLICY "Users insert own contexts"
  ON continu_contexts FOR INSERT
  WITH CHECK (clerk_user_id = auth.jwt()->>'sub');

CREATE POLICY "Users update own contexts"
  ON continu_contexts FOR UPDATE
  USING (clerk_user_id = auth.jwt()->>'sub');

CREATE POLICY "Users delete own contexts"
  ON continu_contexts FOR DELETE
  USING (clerk_user_id = auth.jwt()->>'sub');
```

## UI Requirements

### Design System
- Dark neutral surfaces
- Clear typography
- Crisp borders
- Subtle depth
- Compact controls
- Consistent spacing
- Restrained motion

### HARD RESTRICTIONS (NEVER)
- Purple gradients
- Neon AI styling
- Excessive glow
- Fake holographic interfaces
- Decorative particles
- Meaningless glassmorphism
- Fake dashboards
- Meaningless charts
- Fake activity counts
- Fake testimonials
- Em dash (—)
- Generic placeholder copy
- AI marketing clichés

### Copy Examples
- "Save this context."
- "Insert a saved context here."
- "Add an AI provider to enable prompt cooking."
- "Context saved locally. Waiting to sync."

## Milestones

### M1: Extension Foundation
- Manifest V3 via WXT
- Build system
- Content script shell
- Background worker shell
- Popup shell
- Settings shell

### M2: Clerk Authentication
- @clerk/chrome-extension setup
- Sign in/out
- Session state
- Account switching
- Background token handling

### M3: Supabase Integration
- Schema migrations
- Clerk third-party auth
- RLS policies
- CRUD operations
- Cross-user isolation tests

### M4: Local-First Data
- chrome.storage.local cache
- Sync queue
- Offline behavior
- Versioning

### M5: Drop
- Generic editor detection
- Native adapters (8 sites)
- Safe text injection
- Fallback strategies

### M6: Generate
- Conversation extraction
- Normalization
- Structured context
- Local save
- Cloud sync
- Import/export

### M7: AI Provider Architecture
- Provider abstraction
- Credential storage
- Model selection
- Provider testing

### M8: Cook This Prompt
- Prompt engineering
- Provider selection
- Preview UI
- Replace/Copy/Cancel
- Error handling

### M9: Security Hardening
- Injection testing
- XSS testing
- Auth testing
- Import fuzzing
- Message validation
- Dependency audit

### M10: Polish
- UI positioning
- Accessibility
- Performance
- Empty states
- Copy review

## Acceptance Criteria

See full checklist in original specification sections 78.

## Dependencies

### Production
- `react` ^18.x
- `react-dom` ^18.x
- `@clerk/chrome-extension` (latest)
- `@supabase/supabase-js` ^2.x
- `zod` ^3.x
- `uuid` ^9.x

### Development
- `wxt` (latest)
- `typescript` ^5.x
- `vitest` (testing)
- `@types/chrome`
- `@types/react`
- `@types/react-dom`

## Repository Structure

```
src/
  auth/
    clerk.ts
    session.ts
  database/
    supabase.ts
    contexts.ts
    sync.ts
  security/
    validation.ts
    messaging.ts
  ai/
    provider.ts
    manager.ts
    providers/
      gemini.ts
      openai.ts
      anthropic.ts
      mistral.ts
      openrouter.ts
      groq.ts
      ollama.ts
      custom.ts
  contexts/
    model.ts
    generate.ts
    storage.ts
    import.ts
    export.ts
  adapters/
    base.ts
    manager.ts
    generic.ts
    chatgpt.ts
    claude.ts
    gemini.ts
    perplexity.ts
    mistral.ts
    deepseek.ts
    grok.ts
    copilot.ts
  content/
    content-script.ts
    composer.ts
    ui.ts
  background/
    service-worker.ts
  ui/
    popup/
    sidepanel/
    components/
supabase/
  migrations/
tests/
  auth/
  security/
  adapters/
  sync/
```

## Reference Documentation

- Clerk Chrome Extension: https://clerk.com/docs/llms.txt
- Supabase + Clerk: https://supabase.com/docs/guides/auth/auth-clerk
- WXT: https://wxt.dev/
- Chrome Extension MV3: https://developer.chrome.com/docs/extensions/mv3/
