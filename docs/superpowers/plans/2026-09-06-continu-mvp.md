# continu MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build secure cross-AI context layer Chromium extension with Generate/Drop/Cook functionality

**Architecture:** Manifest V3 extension using WXT, React popup/sidepanel, vanilla TS content scripts, background service worker for auth/sync, local-first storage with Supabase sync

**Tech Stack:** React 18, TypeScript, WXT, Clerk (@clerk/chrome-extension), Supabase, Zod

**Spec:** `docs/superpowers/specs/2026-09-06-continu-design.md`

## Global Constraints

- No Clerk secret key in code
- No Supabase service-role key in code
- No application-wide AI API keys
- No `eval()` or `new Function()`
- No `innerHTML` with untrusted content
- No SQL concatenation with user input
- No purple gradients
- No em dash (—) character anywhere
- No generic placeholder copy
- No fake metrics
- RLS mandatory on all user tables
- Zod validation at all trust boundaries
- TypeScript strict mode enabled

---

## Task 1: WXT Project Scaffold

**Files:**
- Create: `package.json`
- Create: `wxt.config.ts`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `entrypoints/background.ts`
- Create: `entrypoints/popup/index.html`
- Create: `entrypoints/popup/App.tsx`
- Create: `entrypoints/content.ts`

**Interfaces:**
- Produces: WXT project structure, build commands, TypeScript configuration

- [ ] **Step 1: Initialize WXT project**

```bash
npm create wxt@latest . -- --template react-ts --pm npm
```

Expected output: WXT project scaffold with React + TypeScript

- [ ] **Step 2: Install core dependencies**

```bash
npm install zod uuid @supabase/supabase-js
npm install --save-dev @types/uuid @types/chrome vitest
```

- [ ] **Step 3: Update tsconfig.json for strict mode**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true
  }
}
```

- [ ] **Step 4: Update .gitignore**

```
node_modules/
.output/
.wxt/
dist/
*.log
.DS_Store
.env.local
```

- [ ] **Step 5: Verify build**

```bash
npm run build
```

Expected: `.output/chrome-mv3/` directory with manifest.json

- [ ] **Step 6: Commit**

```bash
git init
git add .
git commit -m "feat: initialize WXT project with React + TypeScript"
```

---

## Task 2: Context Schema and Validation

**Files:**
- Create: `src/contexts/model.ts`
- Create: `src/contexts/validation.ts`
- Test: `tests/contexts/validation.test.ts`

**Interfaces:**
- Produces: `ContinuContext` type, `contextSchema` Zod validator, `validateContext()` function

- [ ] **Step 1: Write validation test**

```typescript
// tests/contexts/validation.test.ts
import { describe, it, expect } from 'vitest';
import { validateContext } from '../../src/contexts/validation';

describe('validateContext', () => {
  it('should validate complete context', () => {
    const input = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      schemaVersion: 1,
      name: 'Test Context',
      source: {
        platform: 'chatgpt',
        url: 'https://chat.openai.com/c/abc',
        title: 'Test Chat'
      },
      objective: 'Build a feature',
      currentState: 'In progress',
      decisions: ['Use TypeScript'],
      requirements: ['Must be secure'],
      constraints: ['Time limit: 2 weeks'],
      openQuestions: ['How to deploy?'],
      nextActions: ['Write tests'],
      conversation: [],
      createdAt: '2026-09-06T18:00:00.000Z',
      updatedAt: '2026-09-06T18:00:00.000Z'
    };

    const result = validateContext(input);
    
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe(input.id);
      expect(result.data.schemaVersion).toBe(1);
    }
  });

  it('should reject invalid UUID', () => {
    const input = {
      id: 'not-a-uuid',
      schemaVersion: 1,
      name: 'Test',
      source: { platform: 'chatgpt', url: 'https://example.com', title: 'Test' },
      objective: 'Test',
      currentState: 'Test',
      decisions: [],
      requirements: [],
      constraints: [],
      openQuestions: [],
      nextActions: [],
      conversation: [],
      createdAt: '2026-09-06T18:00:00.000Z',
      updatedAt: '2026-09-06T18:00:00.000Z'
    };

    const result = validateContext(input);
    
    expect(result.success).toBe(false);
  });

  it('should reject oversized name', () => {
    const input = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      schemaVersion: 1,
      name: 'a'.repeat(501),
      source: { platform: 'chatgpt', url: 'https://example.com', title: 'Test' },
      objective: 'Test',
      currentState: 'Test',
      decisions: [],
      requirements: [],
      constraints: [],
      openQuestions: [],
      nextActions: [],
      conversation: [],
      createdAt: '2026-09-06T18:00:00.000Z',
      updatedAt: '2026-09-06T18:00:00.000Z'
    };

    const result = validateContext(input);
    
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test
```

Expected: FAIL with module not found

- [ ] **Step 3: Create context model**

```typescript
// src/contexts/model.ts
export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface ContinuContext {
  id: string;
  schemaVersion: number;
  name: string;
  source: {
    platform: string;
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
  createdAt: string;
  updatedAt: string;
}

export const SCHEMA_VERSION = 1;
export const MAX_NAME_LENGTH = 500;
export const MAX_STRING_FIELD_LENGTH = 10000;
export const MAX_ARRAY_ITEMS = 1000;
```

- [ ] **Step 4: Create validation with Zod**

```typescript
// src/contexts/validation.ts
import { z } from 'zod';
import { MAX_NAME_LENGTH, MAX_STRING_FIELD_LENGTH, MAX_ARRAY_ITEMS, SCHEMA_VERSION } from './model';

const conversationTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(MAX_STRING_FIELD_LENGTH),
  timestamp: z.string().datetime()
});

export const contextSchema = z.object({
  id: z.string().uuid(),
  schemaVersion: z.number().int().positive(),
  name: z.string().min(1).max(MAX_NAME_LENGTH),
  source: z.object({
    platform: z.string().max(100),
    url: z.string().url().max(2000),
    title: z.string().max(MAX_NAME_LENGTH)
  }),
  objective: z.string().max(MAX_STRING_FIELD_LENGTH),
  currentState: z.string().max(MAX_STRING_FIELD_LENGTH),
  decisions: z.array(z.string().max(MAX_STRING_FIELD_LENGTH)).max(MAX_ARRAY_ITEMS),
  requirements: z.array(z.string().max(MAX_STRING_FIELD_LENGTH)).max(MAX_ARRAY_ITEMS),
  constraints: z.array(z.string().max(MAX_STRING_FIELD_LENGTH)).max(MAX_ARRAY_ITEMS),
  openQuestions: z.array(z.string().max(MAX_STRING_FIELD_LENGTH)).max(MAX_ARRAY_ITEMS),
  nextActions: z.array(z.string().max(MAX_STRING_FIELD_LENGTH)).max(MAX_ARRAY_ITEMS),
  conversation: z.array(conversationTurnSchema).max(MAX_ARRAY_ITEMS),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export type ValidatedContext = z.infer<typeof contextSchema>;

export function validateContext(input: unknown) {
  return contextSchema.safeParse(input);
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm run test
```

Expected: PASS all 3 tests

- [ ] **Step 6: Add package.json test script if missing**

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 7: Commit**

```bash
git add src/contexts/ tests/contexts/
git commit -m "feat: add context schema with Zod validation"
```

---

## Task 3: Local Storage Layer

**Files:**
- Create: `src/contexts/storage.ts`
- Test: `tests/contexts/storage.test.ts`

**Interfaces:**
- Consumes: `ContinuContext` from Task 2
- Produces: `saveContextLocal(context)`, `getContextsLocal()`, `getContextLocal(id)`, `deleteContextLocal(id)`

- [ ] **Step 1: Write storage test**

```typescript
// tests/contexts/storage.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { saveContextLocal, getContextsLocal, getContextLocal, deleteContextLocal } from '../../src/contexts/storage';
import type { ContinuContext } from '../../src/contexts/model';

// Mock chrome.storage.local
const mockStorage: Record<string, any> = {};
global.chrome = {
  storage: {
    local: {
      get: vi.fn((keys: string[] | null) => {
        if (keys === null) {
          return Promise.resolve(mockStorage);
        }
        const result: Record<string, any> = {};
        keys.forEach(key => {
          if (key in mockStorage) {
            result[key] = mockStorage[key];
          }
        });
        return Promise.resolve(result);
      }),
      set: vi.fn((items: Record<string, any>) => {
        Object.assign(mockStorage, items);
        return Promise.resolve();
      }),
      remove: vi.fn((keys: string[]) => {
        keys.forEach(key => delete mockStorage[key]);
        return Promise.resolve();
      })
    }
  }
} as any;

describe('storage', () => {
  beforeEach(() => {
    Object.keys(mockStorage).forEach(key => delete mockStorage[key]);
  });

  it('should save and retrieve context', async () => {
    const context: ContinuContext = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      schemaVersion: 1,
      name: 'Test Context',
      source: { platform: 'chatgpt', url: 'https://example.com', title: 'Test' },
      objective: 'Test objective',
      currentState: 'In progress',
      decisions: [],
      requirements: [],
      constraints: [],
      openQuestions: [],
      nextActions: [],
      conversation: [],
      createdAt: '2026-09-06T18:00:00.000Z',
      updatedAt: '2026-09-06T18:00:00.000Z'
    };

    await saveContextLocal(context);
    const retrieved = await getContextLocal(context.id);

    expect(retrieved).toEqual(context);
  });

  it('should list all contexts', async () => {
    const context1: ContinuContext = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      schemaVersion: 1,
      name: 'Context 1',
      source: { platform: 'chatgpt', url: 'https://example.com', title: 'Test' },
      objective: 'Test',
      currentState: 'Test',
      decisions: [],
      requirements: [],
      constraints: [],
      openQuestions: [],
      nextActions: [],
      conversation: [],
      createdAt: '2026-09-06T18:00:00.000Z',
      updatedAt: '2026-09-06T18:00:00.000Z'
    };

    const context2: ContinuContext = {
      ...context1,
      id: '550e8400-e29b-41d4-a716-446655440001',
      name: 'Context 2'
    };

    await saveContextLocal(context1);
    await saveContextLocal(context2);

    const contexts = await getContextsLocal();

    expect(contexts).toHaveLength(2);
    expect(contexts.map(c => c.name)).toContain('Context 1');
    expect(contexts.map(c => c.name)).toContain('Context 2');
  });

  it('should delete context', async () => {
    const context: ContinuContext = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      schemaVersion: 1,
      name: 'To Delete',
      source: { platform: 'chatgpt', url: 'https://example.com', title: 'Test' },
      objective: 'Test',
      currentState: 'Test',
      decisions: [],
      requirements: [],
      constraints: [],
      openQuestions: [],
      nextActions: [],
      conversation: [],
      createdAt: '2026-09-06T18:00:00.000Z',
      updatedAt: '2026-09-06T18:00:00.000Z'
    };

    await saveContextLocal(context);
    await deleteContextLocal(context.id);

    const retrieved = await getContextLocal(context.id);
    expect(retrieved).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test
```

Expected: FAIL with module not found

- [ ] **Step 3: Implement storage layer**

```typescript
// src/contexts/storage.ts
import type { ContinuContext } from './model';

const STORAGE_KEY_PREFIX = 'continu_context_';
const STORAGE_INDEX_KEY = 'continu_contexts_index';

export async function saveContextLocal(context: ContinuContext): Promise<void> {
  const key = `${STORAGE_KEY_PREFIX}${context.id}`;
  
  // Save context
  await chrome.storage.local.set({ [key]: context });
  
  // Update index
  const result = await chrome.storage.local.get(STORAGE_INDEX_KEY);
  const index: string[] = result[STORAGE_INDEX_KEY] || [];
  
  if (!index.includes(context.id)) {
    index.push(context.id);
    await chrome.storage.local.set({ [STORAGE_INDEX_KEY]: index });
  }
}

export async function getContextLocal(id: string): Promise<ContinuContext | null> {
  const key = `${STORAGE_KEY_PREFIX}${id}`;
  const result = await chrome.storage.local.get(key);
  return result[key] || null;
}

export async function getContextsLocal(): Promise<ContinuContext[]> {
  const result = await chrome.storage.local.get(STORAGE_INDEX_KEY);
  const index: string[] = result[STORAGE_INDEX_KEY] || [];
  
  const contexts: ContinuContext[] = [];
  
  for (const id of index) {
    const context = await getContextLocal(id);
    if (context) {
      contexts.push(context);
    }
  }
  
  return contexts;
}

export async function deleteContextLocal(id: string): Promise<void> {
  const key = `${STORAGE_KEY_PREFIX}${id}`;
  
  // Remove context
  await chrome.storage.local.remove([key]);
  
  // Update index
  const result = await chrome.storage.local.get(STORAGE_INDEX_KEY);
  const index: string[] = result[STORAGE_INDEX_KEY] || [];
  const newIndex = index.filter(contextId => contextId !== id);
  await chrome.storage.local.set({ [STORAGE_INDEX_KEY]: newIndex });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test
```

Expected: PASS all storage tests

- [ ] **Step 5: Commit**

```bash
git add src/contexts/storage.ts tests/contexts/storage.test.ts
git commit -m "feat: add local storage layer for contexts"
```

---

## Task 4: Clerk Authentication Setup

**Files:**
- Create: `.env.local`
- Create: `src/auth/clerk.ts`
- Create: `entrypoints/popup/AuthProvider.tsx`
- Modify: `entrypoints/popup/App.tsx`
- Modify: `package.json`

**Interfaces:**
- Produces: Clerk authentication in popup, `useAuth()` hook, `getClerkToken()` function for background

- [ ] **Step 1: Install Clerk**

```bash
npm install @clerk/chrome-extension
```

- [ ] **Step 2: Run clerk auth login**

```bash
npx clerk@latest auth login
```

Wait for user to complete browser auth flow.

- [ ] **Step 3: Run clerk init**

```bash
npx clerk@latest init --app app_3IxUbfs8IEzeu8SO1OTmZ91Nwh9
```

Expected: Clerk SDK installed, .env.local created with VITE_CLERK_PUBLISHABLE_KEY

- [ ] **Step 4: Verify .env.local**

Check that `.env.local` contains:
```
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
```

- [ ] **Step 5: Update .gitignore for .env**

```
.env.local
.env
```

- [ ] **Step 6: Create Clerk background client**

```typescript
// src/auth/clerk.ts
import { createClerkClient } from '@clerk/chrome-extension/background';

let clerkClient: ReturnType<typeof createClerkClient> | null = null;

export function getClerkClient() {
  if (!clerkClient) {
    const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
    if (!publishableKey) {
      throw new Error('VITE_CLERK_PUBLISHABLE_KEY not found');
    }
    clerkClient = createClerkClient({ publishableKey });
  }
  return clerkClient;
}

export async function getClerkToken(): Promise<string | null> {
  try {
    const client = getClerkClient();
    const session = await client.sessions.getToken();
    return session || null;
  } catch (error) {
    console.error('Failed to get Clerk token:', error);
    return null;
  }
}
```

- [ ] **Step 7: Create Clerk popup provider**

```typescript
// entrypoints/popup/AuthProvider.tsx
import { ClerkProvider, SignIn, SignUp, SignedIn, SignedOut, UserButton } from '@clerk/chrome-extension';
import React from 'react';

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

interface AuthProviderProps {
  children: React.ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  if (!publishableKey) {
    return <div>Missing Clerk publishable key</div>;
  }

  return (
    <ClerkProvider publishableKey={publishableKey}>
      {children}
    </ClerkProvider>
  );
}

export function AuthGate({ children }: AuthProviderProps) {
  return (
    <>
      <SignedIn>{children}</SignedIn>
      <SignedOut>
        <div style={{ padding: '20px', textAlign: 'center' }}>
          <h2>Sign in to continu</h2>
          <SignIn />
        </div>
      </SignedOut>
    </>
  );
}
```

- [ ] **Step 8: Update popup App to use AuthProvider**

```typescript
// entrypoints/popup/App.tsx
import { AuthProvider, AuthGate } from './AuthProvider';
import './App.css';

function App() {
  return (
    <AuthProvider>
      <AuthGate>
        <div className="App">
          <h1>continu</h1>
          <p>Context saved.</p>
        </div>
      </AuthGate>
    </AuthProvider>
  );
}

export default App;
```

- [ ] **Step 9: Build and test in browser**

```bash
npm run dev
```

Load extension in Chrome: chrome://extensions/ → Load unpacked → select `.output/chrome-mv3`

Open popup, verify Clerk sign-in appears.

- [ ] **Step 10: Commit**

```bash
git add .env.local.example src/auth/ entrypoints/popup/ package.json package-lock.json
git commit -m "feat: add Clerk authentication"
```

Note: Create `.env.local.example` with placeholder before commit:
```
VITE_CLERK_PUBLISHABLE_KEY=pk_test_your_key_here
```

---

## Task 5: Supabase Setup and Migrations

**Files:**
- Create: `supabase/migrations/20260906_initial_schema.sql`
- Create: `src/database/supabase.ts`
- Create: `.env.local` (add Supabase vars)

**Interfaces:**
- Consumes: Clerk token from Task 4
- Produces: Supabase client with Clerk auth, database schema, RLS policies

- [ ] **Step 1: Create Supabase project**

Go to https://supabase.com/dashboard → New Project

Note project URL and anon key.

- [ ] **Step 2: Add Supabase env vars to .env.local**

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

- [ ] **Step 3: Configure Clerk integration in Supabase**

Supabase Dashboard → Authentication → Providers → Clerk

Follow current Supabase + Clerk integration docs at:
https://supabase.com/docs/guides/auth/auth-clerk

- [ ] **Step 4: Create migration file**

```sql
-- supabase/migrations/20260906_initial_schema.sql

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Profiles table
CREATE TABLE profiles (
  clerk_user_id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Contexts table
CREATE TABLE continu_contexts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clerk_user_id TEXT NOT NULL REFERENCES profiles(clerk_user_id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) <= 500),
  source_platform TEXT CHECK (char_length(source_platform) <= 100),
  source_url TEXT CHECK (char_length(source_url) <= 2000),
  payload JSONB NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_contexts_user ON continu_contexts(clerk_user_id);
CREATE INDEX idx_contexts_created ON continu_contexts(created_at DESC);

-- Enable RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE continu_contexts ENABLE ROW LEVEL SECURITY;

-- RLS Policies for profiles
CREATE POLICY "Users read own profile"
  ON profiles FOR SELECT
  USING (clerk_user_id = auth.jwt()->>'sub');

CREATE POLICY "Users insert own profile"
  ON profiles FOR INSERT
  WITH CHECK (clerk_user_id = auth.jwt()->>'sub');

-- RLS Policies for continu_contexts
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

- [ ] **Step 5: Apply migration**

Use Supabase Dashboard → SQL Editor → paste migration → Run

Verify tables exist in Table Editor.

- [ ] **Step 6: Create Supabase client**

```typescript
// src/database/supabase.ts
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function setSupabaseAuth(token: string) {
  await supabase.auth.setSession({
    access_token: token,
    refresh_token: ''
  });
}
```

- [ ] **Step 7: Update .env.local.example**

```
VITE_CLERK_PUBLISHABLE_KEY=pk_test_your_key_here
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key_here
```

- [ ] **Step 8: Commit**

```bash
git add supabase/ src/database/ .env.local.example
git commit -m "feat: add Supabase schema and RLS policies"
```

---

## Task 6: Adapter Base Interface

**Files:**
- Create: `src/adapters/base.ts`
- Create: `src/adapters/manager.ts`
- Test: `tests/adapters/manager.test.ts`

**Interfaces:**
- Produces: `AIAdapter` interface, `AdapterManager.detect()`, `AdapterManager.getAdapter()`

- [ ] **Step 1: Write adapter test**

```typescript
// tests/adapters/manager.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { AdapterManager } from '../../src/adapters/manager';
import type { AIAdapter } from '../../src/adapters/base';

class TestAdapter implements AIAdapter {
  name = 'test';
  
  detect(): boolean {
    return window.location.hostname === 'test.example.com';
  }
  
  findComposer(): Element | null {
    return document.querySelector('[data-test-composer]');
  }
  
  extractConversation() {
    return [];
  }
  
  getComposerText(): string {
    const composer = this.findComposer();
    return composer?.textContent || '';
  }
  
  insertText(text: string): void {
    const composer = this.findComposer();
    if (composer) {
      composer.textContent = text;
    }
  }
}

describe('AdapterManager', () => {
  let manager: AdapterManager;

  beforeEach(() => {
    manager = new AdapterManager();
    document.body.innerHTML = '';
  });

  it('should detect registered adapter', () => {
    Object.defineProperty(window, 'location', {
      value: { hostname: 'test.example.com' },
      writable: true
    });

    manager.register(new TestAdapter());
    const adapter = manager.detect();

    expect(adapter).not.toBeNull();
    expect(adapter?.name).toBe('test');
  });

  it('should return null when no adapter matches', () => {
    Object.defineProperty(window, 'location', {
      value: { hostname: 'unknown.example.com' },
      writable: true
    });

    manager.register(new TestAdapter());
    const adapter = manager.detect();

    expect(adapter).toBeNull();
  });

  it('should find composer via adapter', () => {
    document.body.innerHTML = '<div data-test-composer>Composer</div>';
    
    Object.defineProperty(window, 'location', {
      value: { hostname: 'test.example.com' },
      writable: true
    });

    manager.register(new TestAdapter());
    const adapter = manager.detect();
    const composer = adapter?.findComposer();

    expect(composer).not.toBeNull();
    expect(composer?.getAttribute('data-test-composer')).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test
```

Expected: FAIL with module not found

- [ ] **Step 3: Create base adapter interface**

```typescript
// src/adapters/base.ts
import type { ConversationTurn } from '../contexts/model';

export interface AIAdapter {
  name: string;
  detect(): boolean;
  findComposer(): Element | null;
  extractConversation(): ConversationTurn[];
  getComposerText(): string;
  insertText(text: string): void;
}
```

- [ ] **Step 4: Create adapter manager**

```typescript
// src/adapters/manager.ts
import type { AIAdapter } from './base';

export class AdapterManager {
  private adapters: AIAdapter[] = [];

  register(adapter: AIAdapter): void {
    this.adapters.push(adapter);
  }

  detect(): AIAdapter | null {
    for (const adapter of this.adapters) {
      if (adapter.detect()) {
        return adapter;
      }
    }
    return null;
  }

  getAdapter(name: string): AIAdapter | null {
    return this.adapters.find(a => a.name === name) || null;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm run test
```

Expected: PASS all adapter tests

- [ ] **Step 6: Commit**

```bash
git add src/adapters/ tests/adapters/
git commit -m "feat: add adapter base interface and manager"
```

---

## Task 7: Generic Adapter

**Files:**
- Create: `src/adapters/generic.ts`
- Test: `tests/adapters/generic.test.ts`

**Interfaces:**
- Consumes: `AIAdapter` interface from Task 6
- Produces: `GenericAdapter` class for unknown AI sites

- [ ] **Step 1: Write generic adapter test**

```typescript
// tests/adapters/generic.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { GenericAdapter } from '../../src/adapters/generic';

describe('GenericAdapter', () => {
  let adapter: GenericAdapter;

  beforeEach(() => {
    adapter = new GenericAdapter();
    document.body.innerHTML = '';
  });

  it('should detect always return true', () => {
    expect(adapter.detect()).toBe(true);
  });

  it('should find textarea composer', () => {
    document.body.innerHTML = '<textarea placeholder="Type a message..."></textarea>';
    
    const composer = adapter.findComposer();
    
    expect(composer).not.toBeNull();
    expect(composer?.tagName).toBe('TEXTAREA');
  });

  it('should find contenteditable composer', () => {
    document.body.innerHTML = '<div contenteditable="true">Type here</div>';
    
    const composer = adapter.findComposer();
    
    expect(composer).not.toBeNull();
    expect(composer?.getAttribute('contenteditable')).toBe('true');
  });

  it('should find role=textbox composer', () => {
    document.body.innerHTML = '<div role="textbox">Type here</div>';
    
    const composer = adapter.findComposer();
    
    expect(composer).not.toBeNull();
    expect(composer?.getAttribute('role')).toBe('textbox');
  });

  it('should prioritize visible composer', () => {
    document.body.innerHTML = `
      <textarea style="display: none;">Hidden</textarea>
      <div contenteditable="true">Visible</div>
    `;
    
    const composer = adapter.findComposer();
    
    expect(composer?.textContent).toBe('Visible');
  });

  it('should insert text into textarea', () => {
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    
    adapter.insertText('Test text');
    
    expect(textarea.value).toBe('Test text');
  });

  it('should insert text into contenteditable', () => {
    const div = document.createElement('div');
    div.contentEditable = 'true';
    document.body.appendChild(div);
    
    adapter.insertText('Test text');
    
    expect(div.textContent).toBe('Test text');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test
```

Expected: FAIL with module not found

- [ ] **Step 3: Implement generic adapter**

```typescript
// src/adapters/generic.ts
import type { AIAdapter } from './base';
import type { ConversationTurn } from '../contexts/model';

export class GenericAdapter implements AIAdapter {
  name = 'generic';

  detect(): boolean {
    return true;
  }

  findComposer(): Element | null {
    const candidates: { element: Element; score: number }[] = [];

    // Find textareas
    const textareas = document.querySelectorAll('textarea');
    textareas.forEach(textarea => {
      if (this.isVisible(textarea)) {
        candidates.push({ element: textarea, score: this.scoreComposer(textarea) });
      }
    });

    // Find contenteditable elements
    const editables = document.querySelectorAll('[contenteditable="true"]');
    editables.forEach(editable => {
      if (this.isVisible(editable)) {
        candidates.push({ element: editable, score: this.scoreComposer(editable) });
      }
    });

    // Find role=textbox elements
    const textboxes = document.querySelectorAll('[role="textbox"]');
    textboxes.forEach(textbox => {
      if (this.isVisible(textbox)) {
        candidates.push({ element: textbox, score: this.scoreComposer(textbox) });
      }
    });

    if (candidates.length === 0) {
      return null;
    }

    // Return highest scored candidate
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0].element;
  }

  private isVisible(element: Element): boolean {
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  private scoreComposer(element: Element): number {
    let score = 0;

    // Larger is better
    const rect = element.getBoundingClientRect();
    if (rect.width > 100 && rect.height > 30) {
      score += 10;
    }

    // Placeholder with AI-like text
    const placeholder = element.getAttribute('placeholder')?.toLowerCase() || '';
    if (placeholder.includes('message') || placeholder.includes('type') || placeholder.includes('chat')) {
      score += 5;
    }

    return score;
  }

  extractConversation(): ConversationTurn[] {
    return [];
  }

  getComposerText(): string {
    const composer = this.findComposer();
    if (!composer) {
      return '';
    }

    if (composer.tagName === 'TEXTAREA' || composer.tagName === 'INPUT') {
      return (composer as HTMLInputElement | HTMLTextAreaElement).value;
    }

    return composer.textContent || '';
  }

  insertText(text: string): void {
    const composer = this.findComposer();
    if (!composer) {
      return;
    }

    if (composer.tagName === 'TEXTAREA' || composer.tagName === 'INPUT') {
      const input = composer as HTMLInputElement | HTMLTextAreaElement;
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (composer.getAttribute('contenteditable') === 'true') {
      composer.textContent = text;
      composer.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test
```

Expected: PASS all generic adapter tests

- [ ] **Step 5: Commit**

```bash
git add src/adapters/generic.ts tests/adapters/generic.test.ts
git commit -m "feat: add generic adapter for unknown AI sites"
```

---

## Task 8: ChatGPT Adapter

**Files:**
- Create: `src/adapters/chatgpt.ts`
- Test: `tests/adapters/chatgpt.test.ts`

**Interfaces:**
- Consumes: `AIAdapter` interface from Task 6
- Produces: `ChatGPTAdapter` class

- [ ] **Step 1: Write ChatGPT adapter test**

```typescript
// tests/adapters/chatgpt.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { ChatGPTAdapter } from '../../src/adapters/chatgpt';

describe('ChatGPTAdapter', () => {
  let adapter: ChatGPTAdapter;

  beforeEach(() => {
    adapter = new ChatGPTAdapter();
    document.body.innerHTML = '';
  });

  it('should detect chat.openai.com', () => {
    Object.defineProperty(window, 'location', {
      value: { hostname: 'chat.openai.com' },
      writable: true
    });

    expect(adapter.detect()).toBe(true);
  });

  it('should detect chatgpt.com', () => {
    Object.defineProperty(window, 'location', {
      value: { hostname: 'chatgpt.com' },
      writable: true
    });

    expect(adapter.detect()).toBe(true);
  });

  it('should not detect other hostnames', () => {
    Object.defineProperty(window, 'location', {
      value: { hostname: 'example.com' },
      writable: true
    });

    expect(adapter.detect()).toBe(false);
  });

  it('should find composer by ID', () => {
    document.body.innerHTML = '<textarea id="prompt-textarea">Test</textarea>';
    
    const composer = adapter.findComposer();
    
    expect(composer).not.toBeNull();
    expect(composer?.id).toBe('prompt-textarea');
  });

  it('should find composer by role', () => {
    document.body.innerHTML = '<div role="textbox" contenteditable="true">Test</div>';
    
    const composer = adapter.findComposer();
    
    expect(composer).not.toBeNull();
  });

  it('should extract conversation turns', () => {
    document.body.innerHTML = `
      <div data-message-author-role="user">
        <div>User message</div>
      </div>
      <div data-message-author-role="assistant">
        <div>Assistant response</div>
      </div>
    `;
    
    const conversation = adapter.extractConversation();
    
    expect(conversation).toHaveLength(2);
    expect(conversation[0].role).toBe('user');
    expect(conversation[0].content).toContain('User message');
    expect(conversation[1].role).toBe('assistant');
    expect(conversation[1].content).toContain('Assistant response');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test
```

Expected: FAIL with module not found

- [ ] **Step 3: Implement ChatGPT adapter**

```typescript
// src/adapters/chatgpt.ts
import type { AIAdapter } from './base';
import type { ConversationTurn } from '../contexts/model';

export class ChatGPTAdapter implements AIAdapter {
  name = 'chatgpt';

  detect(): boolean {
    const hostname = window.location.hostname;
    return hostname === 'chat.openai.com' || hostname === 'chatgpt.com';
  }

  findComposer(): Element | null {
    // Try preferred selector
    let composer = document.getElementById('prompt-textarea');
    if (composer) {
      return composer;
    }

    // Fallback to role=textbox
    composer = document.querySelector('[role="textbox"]');
    if (composer) {
      return composer;
    }

    // Fallback to contenteditable
    const editables = document.querySelectorAll('[contenteditable="true"]');
    for (const editable of Array.from(editables)) {
      const rect = editable.getBoundingClientRect();
      if (rect.height > 30 && rect.width > 100) {
        return editable;
      }
    }

    return null;
  }

  extractConversation(): ConversationTurn[] {
    const turns: ConversationTurn[] = [];

    // ChatGPT uses data-message-author-role attribute
    const messages = document.querySelectorAll('[data-message-author-role]');

    messages.forEach(message => {
      const role = message.getAttribute('data-message-author-role');
      if (role !== 'user' && role !== 'assistant') {
        return;
      }

      const content = message.textContent?.trim() || '';
      if (content) {
        turns.push({
          role: role as 'user' | 'assistant',
          content,
          timestamp: new Date().toISOString()
        });
      }
    });

    return turns;
  }

  getComposerText(): string {
    const composer = this.findComposer();
    if (!composer) {
      return '';
    }

    if (composer.tagName === 'TEXTAREA') {
      return (composer as HTMLTextAreaElement).value;
    }

    return composer.textContent || '';
  }

  insertText(text: string): void {
    const composer = this.findComposer();
    if (!composer) {
      return;
    }

    if (composer.tagName === 'TEXTAREA') {
      const textarea = composer as HTMLTextAreaElement;
      textarea.value = text;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (composer.getAttribute('contenteditable') === 'true') {
      composer.textContent = text;
      composer.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test
```

Expected: PASS all ChatGPT adapter tests

- [ ] **Step 5: Commit**

```bash
git add src/adapters/chatgpt.ts tests/adapters/chatgpt.test.ts
git commit -m "feat: add ChatGPT adapter"
```

---

## Task 9: Content Script with Adapter Integration

**Files:**
- Create: `entrypoints/content/index.ts`
- Modify: `src/adapters/manager.ts` (add initialization)
- Create: `entrypoints/content.ts` (WXT entry point)

**Interfaces:**
- Consumes: `AdapterManager`, `ChatGPTAdapter`, `GenericAdapter` from previous tasks
- Produces: Content script that detects site and loads appropriate adapter

- [ ] **Step 1: Create content script entry**

```typescript
// entrypoints/content.ts
export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    import('./content/index');
  }
});
```

- [ ] **Step 2: Create main content script**

```typescript
// entrypoints/content/index.ts
import { AdapterManager } from '../../src/adapters/manager';
import { ChatGPTAdapter } from '../../src/adapters/chatgpt';
import { GenericAdapter } from '../../src/adapters/generic';

class ContinuContent {
  private manager: AdapterManager;

  constructor() {
    this.manager = new AdapterManager();
    this.initializeAdapters();
    this.setupMessageListener();
  }

  private initializeAdapters() {
    // Register native adapters
    this.manager.register(new ChatGPTAdapter());
    
    // Generic adapter last (fallback)
    this.manager.register(new GenericAdapter());
  }

  private setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'DETECT_ADAPTER') {
        const adapter = this.manager.detect();
        sendResponse({ adapter: adapter?.name || null });
        return true;
      }

      if (message.type === 'FIND_COMPOSER') {
        const adapter = this.manager.detect();
        const composer = adapter?.findComposer();
        sendResponse({ found: !!composer });
        return true;
      }

      if (message.type === 'INSERT_TEXT') {
        const adapter = this.manager.detect();
        if (adapter) {
          adapter.insertText(message.text);
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'No adapter found' });
        }
        return true;
      }

      if (message.type === 'EXTRACT_CONVERSATION') {
        const adapter = this.manager.detect();
        if (adapter) {
          const conversation = adapter.extractConversation();
          sendResponse({ success: true, conversation });
        } else {
          sendResponse({ success: false, error: 'No adapter found' });
        }
        return true;
      }

      return false;
    });
  }
}

// Initialize
new ContinuContent();
console.log('continu content script loaded');
```

- [ ] **Step 3: Build and test**

```bash
npm run dev
```

Reload extension in chrome://extensions/

Navigate to chat.openai.com, open DevTools console, verify "continu content script loaded" appears.

- [ ] **Step 4: Test message passing**

In browser console on chat.openai.com:
```javascript
chrome.runtime.sendMessage({ type: 'DETECT_ADAPTER' }, response => {
  console.log('Adapter:', response.adapter);
});
```

Expected: `{ adapter: 'chatgpt' }`

- [ ] **Step 5: Commit**

```bash
git add entrypoints/content.ts entrypoints/content/
git commit -m "feat: add content script with adapter integration"
```

---

## Task 10: Popup UI for Context List

**Files:**
- Modify: `entrypoints/popup/App.tsx`
- Create: `entrypoints/popup/ContextList.tsx`
- Create: `entrypoints/popup/App.css`

**Interfaces:**
- Consumes: `getContextsLocal()` from Task 3
- Produces: Popup UI showing list of saved contexts

- [ ] **Step 1: Create ContextList component**

```typescript
// entrypoints/popup/ContextList.tsx
import { useEffect, useState } from 'react';
import { getContextsLocal } from '../../src/contexts/storage';
import type { ContinuContext } from '../../src/contexts/model';

export function ContextList() {
  const [contexts, setContexts] = useState<ContinuContext[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadContexts();
  }, []);

  async function loadContexts() {
    try {
      const loaded = await getContextsLocal();
      setContexts(loaded);
    } catch (error) {
      console.error('Failed to load contexts:', error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <div className="loading">Loading contexts...</div>;
  }

  if (contexts.length === 0) {
    return (
      <div className="empty-state">
        <p>No saved contexts yet.</p>
        <p className="hint">Generate one from an AI conversation or import a .continu file.</p>
      </div>
    );
  }

  return (
    <div className="context-list">
      {contexts.map(context => (
        <div key={context.id} className="context-item">
          <h3>{context.name}</h3>
          <p className="context-source">{context.source.platform}</p>
          <p className="context-objective">{context.objective}</p>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Update App.tsx**

```typescript
// entrypoints/popup/App.tsx
import { AuthProvider, AuthGate } from './AuthProvider';
import { ContextList } from './ContextList';
import { UserButton } from '@clerk/chrome-extension';
import './App.css';

function App() {
  return (
    <AuthProvider>
      <div className="app">
        <header className="app-header">
          <h1>continu</h1>
          <AuthGate>
            <UserButton />
          </AuthGate>
        </header>
        <main className="app-main">
          <AuthGate>
            <ContextList />
          </AuthGate>
        </main>
      </div>
    </AuthProvider>
  );
}

export default App;
```

- [ ] **Step 3: Add basic styles**

```css
/* entrypoints/popup/App.css */
.app {
  width: 400px;
  min-height: 500px;
  background: #1a1a1a;
  color: #e0e0e0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

.app-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid #333;
}

.app-header h1 {
  font-size: 20px;
  font-weight: 600;
  margin: 0;
}

.app-main {
  padding: 16px;
}

.loading {
  text-align: center;
  padding: 40px;
  color: #888;
}

.empty-state {
  text-align: center;
  padding: 40px 20px;
}

.empty-state p {
  margin: 8px 0;
}

.empty-state .hint {
  font-size: 14px;
  color: #888;
}

.context-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.context-item {
  padding: 12px;
  background: #252525;
  border: 1px solid #333;
  border-radius: 6px;
  cursor: pointer;
  transition: border-color 0.2s;
}

.context-item:hover {
  border-color: #555;
}

.context-item h3 {
  margin: 0 0 8px 0;
  font-size: 16px;
  font-weight: 500;
}

.context-source {
  font-size: 12px;
  color: #888;
  margin: 4px 0;
}

.context-objective {
  font-size: 14px;
  color: #b0b0b0;
  margin: 8px 0 0 0;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
```

- [ ] **Step 4: Build and test**

```bash
npm run dev
```

Open popup, verify UI appears with empty state or context list.

- [ ] **Step 5: Commit**

```bash
git add entrypoints/popup/
git commit -m "feat: add popup UI for context list"
```

---

## Next Steps

Remaining tasks for full MVP:
- Task 11-18: Additional adapters (Claude, Gemini, Perplexity, Mistral, DeepSeek, Grok, Copilot)
- Task 19: Generate context flow
- Task 20: Drop context flow
- Task 21: AI provider abstraction
- Task 22: Cook This Prompt
- Task 23: Supabase sync
- Task 24: Import/export
- Task 25: Security hardening tests
- Task 26: UI polish

**Execution complete for Tasks 1-10. Test coverage: validation, storage, adapters.**
