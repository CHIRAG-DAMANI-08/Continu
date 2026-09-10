# Continu

Continu is a Chromium Manifest V3 browser extension that captures structured context from one AI chat and moves it into another. The product name is **continu** (lowercase). Version in `package.json` is `0.1.0`.

The problem it solves: people bounce between ChatGPT, Claude, Gemini, and other assistants, then reconstruct the same goal, decisions, and transcript by hand. Continu extracts that state, stores it locally (scoped to the signed-in user), optionally syncs it encrypted to Supabase, and injects it into another composer.

Manifest description: **Secure cross-AI context layer**.

This file describes the **current codebase**, not the original design spec. The spec at `docs/superpowers/specs/2026-09-06-continu-design.md` still mentions Clerk and a side panel. Auth is now **Supabase Auth**. There is **no side panel**. Site adapters collapsed into a **universal detector**.

---

## Who it is for

Anyone who uses more than one web AI chat and wants continuity without pasting a raw transcript every time.

Typical loop:

1. Work in ChatGPT (or any detected AI page).
2. Generate a Continu context from the visible conversation.
3. Open Claude / Gemini / another chat.
4. Arm or drop that context into the composer, then type the next prompt.

Generate does not call an AI provider. Cook Prompt does, and only if the user stored their own API key (BYOK).

---

## Core features

### Generate

Capture the current page conversation, normalize it into a `ContinuContext`, save it immediately in `chrome.storage.local` under the authenticated user, then enqueue encrypted upload to Supabase.

- Requires sign-in.
- Works from the popup **+ Generate** button and from the in-page composer icon.
- If extraction finds turns, `generateContext()` builds name, objective, current state, decisions, requirements, constraints, questions, next actions, and up to 500 turns.
- If extraction is empty, `generateMinimalContext()` still saves a shell from URL, title, and platform.
- Generate **unrolls** prior Continu envelopes (`[Prior Conversation History]`, `[CONTINU CONTEXT TRANSFER]`, etc.) so chained transfers do not nest forever.
- Handshake replies like `Got the context, let's go!` are stripped so they do not pollute memory.

### Drop

Insert a saved context into the active AI composer. The user reviews and submits. Structured / compact / full inserts do not auto-submit.

Formats (`src/contexts/format.ts`):

| Format | Behavior |
| --- | --- |
| `hidden` (default) | Arms the composer. Next send bundles full context + transcript + a directive that the model should reply only with `Got the context, let's go! What are we working on?` |
| `structured` | Markdown sections: objective, state, decisions, requirements, constraints, questions, actions, conversation |
| `full` | Same as structured today |
| `compact` | Short goal/state/decisions/next plus last 8 turns truncated |

### Arm / disarm (COA 1)

Arming attaches a context to the in-page composer without dumping a wall of text into the visible box. On Enter / send, Continu intercepts, prepends `formatPromptWithContext()`, and submits. Disarm clears that attachment.

Popup detail view: choosing `hidden` sends `ARM_CONTEXT`. Other formats send `DROP_CONTEXT`.

### Cook Prompt

Optional prompt rewriter using the user's BYOK provider.

- Disabled until an API key exists in Settings.
- Reads draft text from the active composer, or lets the user paste in a modal.
- Preview is editable. Actions: insert into chatbox, copy, close.
- Never auto-submits the chat.
- Output is forced to plain text (`COOK_SYSTEM_PROMPT` plus `cleanCookedPrompt()` strips markdown bold, headings, wrapping quotes, code fences).
- Rate limit: 10 cooks per 60s, 2s cooldown.

Providers: OpenAI, Anthropic, Gemini, OpenRouter, Groq. Settings can fetch live model lists (Anthropic uses a hardcoded list). Keys are stored locally with a light `enc:v1:` obfuscation, not full E2EE.

### In-page composer icon

On detected AI chat pages, a Shadow DOM icon sits in the composer toolbar (right side, left of native send/mic icons).

From that panel the user can generate, search saved contexts, pick a drop format, arm, drop, cook, and drag a context onto the composer (dropzone overlay: "Drop to attach context"). Theme follows `continu_theme`. Icon injects only when `isAIChatPage()` / adapter detection succeeds.

Content script matches `<all_urls>` but detection excludes search, shopping, social, GitHub issues, etc., so the icon should not appear on a random search bar.

### Import / export

- Export one context as `{name}.continu` JSON, or a bundle `{ version, exportedAt, contexts }`.
- Import validates with Zod. Max file size 10MB.
- Popup header has import/export controls.

### Sync

Two-way sync when authenticated and Supabase env vars exist:

1. Drain per-user upsert/delete queue.
2. Upload local contexts (encrypted).
3. Download remote rows, decrypt, keep the newer `updatedAt`.

Popup **Sync** button reports `Encrypted sync: ↑N ↓N`. Login and account switch trigger auto-sync. Empty local list on `GET_CONTEXTS` also pulls remote.

### Auth

Popup is wrapped in `AuthGate` + `SupabaseAuthProvider`.

- Email/password sign in and sign up
- Email OTP verification step
- Forgot password
- Google OAuth via `chrome.identity.launchWebAuthFlow` and Supabase PKCE
- Session persisted in `chrome.storage.local` (popups have no reliable `localStorage`; MV3 workers are ephemeral)
- Account switch clears the previous user's local contexts and sync queue
- Sign-out is rate limited (1 per 3s)

### Theme

Dark (default) and light. Stored as `continu_theme`. Applied on popup, auth gate, and composer overlay.

---

## Context data model

Defined in `src/contexts/model.ts` (schema version `1`):

```ts
interface ContinuContext {
  id: string;                 // UUID
  schemaVersion: number;
  name: string;
  source: { platform: string; url: string; title: string };
  objective: string;
  currentState: string;
  decisions: string[];
  requirements: string[];
  constraints: string[];
  openQuestions: string[];
  nextActions: string[];
  conversation: ConversationTurn[];  // role user|assistant, content, timestamp
  createdAt: string;          // ISO
  updatedAt: string;
}
```

Limits: name 500 chars; string fields 500_000; arrays 1000 items; conversation 500 turns.

`generateContext()` also attaches `summary`, `tags`, and `turnCount`. The Zod schema in `validation.ts` does not require those extra fields, so they can exist on generated objects without failing import of older files.

Local keys are user-scoped: `continu_u_{userId}_context_{id}` plus an index key. Legacy unscoped keys can be purged on logout.

---

## Architecture

```
AI page DOM
    │ content script (UniversalAIAdapter + ComposerIcon)
    ▼
Background service worker
    │ generate / drop / arm / cook / storage / sync
    ▼
chrome.storage.local  (plaintext, user-scoped)
    │ encrypt AES-256-GCM on the client
    ▼
Supabase Postgres + RLS  (ciphertext only)
```

| Layer | Role |
| --- | --- |
| `entrypoints/popup/` | React 18 UI: list, detail, settings, auth |
| `entrypoints/background.ts` | Message hub, generate, arm/drop, cook, auth check, sync enqueue |
| `entrypoints/content.ts` | Adapter detect, extract, insert, arm, composer icon |
| `src/contexts/` | Schema, generate, format, local storage, import/export |
| `src/adapters/` | Universal detection + per-site re-exports |
| `src/database/` | Supabase client, encrypted CRUD, sync queue |
| `src/ai/` | BYOK cook, model fetch, key storage, connection test |
| `src/security/` | Encryption, message types/Zod, rate limiter |
| `supabase/migrations/` | Profiles, encrypted contexts, RLS |

Build system: **WXT**. Default browser: Chrome. Firefox scripts exist (`dev:firefox`, `build:firefox`). Permissions: `storage`, `unlimitedStorage`, `activeTab`, `tabs`, `identity`. Host: `<all_urls>` plus `https://*.supabase.co/*`.

There is a Chrome extension public key in `wxt.config.ts` so the extension ID stays stable for OAuth.

---

## Supported AI surfaces

Runtime detection uses `UniversalAIAdapter` (`src/adapters/universal.ts`). Known hosts include:

chatgpt.com, openai.com, claude.ai, gemini.google.com, perplexity.ai, deepseek.com, grok.com, copilot.microsoft.com, mistral.ai, poe.com, v0.dev, huggingface.co, qwenlm.ai, kimi.moonshot.cn, doubao.com, typingmind.com, phind.com, you.com, bolt.new

Unknown / self-hosted chats can still match via DOM heuristics (composer, model-name keywords, chat layout). Confidence scoring plus a denylist keep Google Search, Amazon, Reddit, YouTube, GitHub issues, and similar sites out.

Files like `chatgpt.ts` / `claude.ts` re-export the universal adapter. `AdapterManager` currently registers only `UniversalAIAdapter`.

Adapter contract (`src/adapters/base.ts`): `detect`, `findComposer`, `findSubmitButton`, optional attach/file input, `extractConversation`, `getComposerText`, `insertText`, `submitText`.

---

## Security (as implemented)

**Auth and isolation**

- Supabase Auth; RLS on `profiles` and `continu_contexts` with `user_id = auth.uid()`.
- Client never uses the service-role key. Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- Background rejects messages whose `sender.id` is not this extension.

**Encryption**

- Remote payload is AES-256-GCM. Key is PBKDF2 (100k iterations, SHA-256) from `continu:e2ee:user:{userId}` plus a per-user salt.
- Salt is deterministic from SHA-256(`continu:salt:v1:{userId}`) so another device can decrypt without copying local salt.
- Database columns: `encrypted_payload`, `encryption_iv`, `encryption_version`. No plaintext name, URL, or conversation on the server.
- Local cache is **not** encrypted (plaintext in chrome.storage).

This is client-side encryption keyed from the user id, not a user-held passphrase. Anyone who can obtain both the ciphertext and the same user id derivation can decrypt. The UI still labels the product **E2EE**.

**Validation and XSS**

- Zod at import and context boundaries.
- `sanitizeString` / `sanitizeContext` (NFKC, strip nulls and control chars).
- Composer UI uses closed Shadow DOM.
- Logger redacts secrets.

**Rate limits** (`src/security/rate-limiter.ts`)

- Sign in: 5 / 60s
- Sign up: 3 / 60s
- Sign out: 1 / 3s
- Cook: 10 / 60s, 2s gap
- Model list: 10 / 60s, 1s gap

**Product rules still in force**

- No app-wide AI API keys.
- No `eval` / `new Function`.
- No `innerHTML` with untrusted content.
- No SQL string concatenation (Supabase query builder).
- UI: no purple gradients, neon "AI" look, fake metrics, or em dash in product copy.

---

## Database

Latest intended schema: `supabase/migrations/20260909_supabase_auth_migration.sql` (drops Clerk-era tables) plus `20260910_security_fixes.sql`.

- `profiles.user_id` UUID PK → `auth.users(id)`
- `continu_contexts`: id, user_id, encrypted_payload, encryption_iv, encryption_version, timestamps
- Trigger `handle_new_user` inserts a profile on signup
- Older files `20260906_initial_schema.sql` and `20260908_encrypted_contexts.sql` are historical (Clerk `clerk_user_id`)

---

## Popup UI map

| View | File | What it does |
| --- | --- | --- |
| Auth | `AuthGate.tsx` | Sign in / up / Google / forgot password |
| List | `ContextList.tsx` | Saved contexts, drag handle onto chat |
| Detail | `ContextDetail.tsx` | Fields, format picker, drop/arm, copy, export, delete |
| Settings | `SettingsView.tsx` | BYOK providers, test connection, fetch models |
| Import/export | `ImportExport.tsx` | `.continu` files |
| Avatar | `UserAvatarMenu.tsx` | Account / settings / sign out |

Header shows an **E2EE** badge. Toolbar: Generate, Cook Prompt, Sync.

---

## Messaging

`src/security/messaging.ts` `MessageType` enum (content ↔ background ↔ popup):

`DETECT_ADAPTER`, `FIND_COMPOSER`, `EXTRACT_CONVERSATION`, `INSERT_TEXT`, `SUBMIT_TEXT`, `GENERATE_CONTEXT`, `DROP_CONTEXT`, `ARM_CONTEXT`, `DISARM_CONTEXT`, `SAVE_CONTEXT`, `GET_CONTEXTS`, `GET_CONTEXT`, `DELETE_CONTEXT`, `GET_PAGE_INFO`, `CHECK_AUTH`, `COOK_PROMPT`, `GET_AI_STATUS`, `SYNC_REMOTE`.

---

## Tech stack

| Piece | Choice |
| --- | --- |
| Language | TypeScript (strict) |
| Popup | React 18 |
| Extension build | WXT 0.14 |
| Validation | Zod 3 |
| Backend | Supabase JS 2 (Auth + Postgres + RLS) |
| Tests | Vitest + happy-dom |
| Crypto | Web Crypto API |

Env (not committed): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

Scripts: `npm run dev`, `build`, `zip`, `test`, `lint`. Output typically `.output/chrome-mv3/`.

---

## Repository layout

```
entrypoints/          WXT entrypoints (background, content, popup)
src/adapters/         Universal AI page detection and DOM IO
src/ai/               Cook Prompt + BYOK storage
src/content/          Composer icon, dropzone, arm intercept
src/contexts/         Context model, generate, format, local store, I/O
src/database/         Supabase client, encrypted CRUD, sync
src/security/         Encryption, messages, rate limits
src/utils/            Logger
supabase/migrations/  SQL
docs/superpowers/     Original design spec and MVP plan (partly stale)
public/icon/          16 / 48 / 128 PNG + SVG
```

---

## How to run

1. `npm install`
2. Put Supabase URL and anon key in `.env` / `.env.local` as Vite vars
3. Apply migrations on the Supabase project
4. `npm run dev` then load the unpacked WXT output in `chrome://extensions`
5. Sign in, open an AI chat, Generate, then Drop/Arm on another chat

`npm test` for unit tests (validation, generate, format, encryption, adapters, cook, sync-related modules, composer icon, drop guarantees).

---

## What is not true anymore (spec drift)

- Clerk is gone. Use Supabase Auth (`auth.uid()`).
- No side panel entrypoint.
- Per-site adapter classes are stubs; one universal adapter runs.
- Generate in the shipping app requires login (the original spec said generate must work fully offline without auth).
- `hidden` / arm is the primary transfer path, not "never auto-submit" for that path: arm **does** intercept submit to inject context, then send. Visible structured/compact drops still leave submit to the user.
- `full` and `structured` formats currently produce the same markdown.

---

## Design language

Dark-first, compact controls, crisp borders, restrained motion. Copy should be concrete: "Save this context.", "Insert a saved context here.", "Context saved locally. Waiting to sync." Avoid AI marketing clichés and fake dashboards.

---

## Related docs

- Design spec (historical): `docs/superpowers/specs/2026-09-06-continu-design.md`
- MVP plan (historical): `docs/superpowers/plans/2026-09-06-continu-mvp.md`

Prefer this `CONTEXT.md` and the source tree when they disagree with those files.
