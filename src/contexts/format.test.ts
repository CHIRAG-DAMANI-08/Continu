import { describe, it, expect } from 'vitest';
import { formatContext } from './format';
import type { ContinuContext } from './model';

describe('formatContext', () => {
  const sampleContext: ContinuContext = {
    id: 'test-123',
    userId: 'user-1',
    name: 'Migration to PostgreSQL',
    summary: 'Discussion about database migration',
    objective: 'Migrate from SQLite to PostgreSQL without downtime',
    currentState: 'Schema designed, pending review',
    decisions: ['Use Supabase for hosting', 'Use pgvector for embeddings'],
    requirements: ['99.9% uptime during switch'],
    constraints: ['Max 2 hour maintenance window'],
    openQuestions: ['How to handle replication lag?'],
    nextActions: ['Run shadow traffic tests'],
    source: {
      platform: 'chatgpt',
      url: 'https://chatgpt.com/c/123',
      title: 'PostgreSQL Migration',
    },
    tags: ['database', 'migration'],
    turnCount: 8,
    conversation: [
      { role: 'user', content: 'What database should we use?' },
      { role: 'assistant', content: 'PostgreSQL with Supabase.' },
    ],
    createdAt: '2026-09-07T12:00:00Z',
    updatedAt: '2026-09-07T12:30:00Z',
  };

  it('formats structured context with all markdown sections (PRD default)', () => {
    const formatted = formatContext(sampleContext, 'structured');
    expect(formatted).toContain('# Context: Migration to PostgreSQL');
    expect(formatted).toContain('Source: chatgpt (PostgreSQL Migration)');
    expect(formatted).toContain('## Objective');
    expect(formatted).toContain('Migrate from SQLite to PostgreSQL without downtime');
    expect(formatted).toContain('## Decisions Made');
    expect(formatted).toContain('- Use Supabase for hosting');
    expect(formatted).toContain('## Requirements');
    expect(formatted).toContain('- 99.9% uptime during switch');
    expect(formatted).toContain('## Constraints');
    expect(formatted).toContain('- Max 2 hour maintenance window');
    expect(formatted).toContain('## Open Questions');
    expect(formatted).toContain('- How to handle replication lag?');
    expect(formatted).toContain('## Next Actions');
    expect(formatted).toContain('- Run shadow traffic tests');
  });

  it('formats compact context with essential continuation information', () => {
    const formatted = formatContext(sampleContext, 'compact');
    expect(formatted).toContain('Context: Migration to PostgreSQL');
    expect(formatted).toContain('Goal: Migrate from SQLite to PostgreSQL without downtime');
    expect(formatted).toContain('Decisions: Use Supabase for hosting; Use pgvector for embeddings');
    expect(formatted).toContain('Next: Run shadow traffic tests');
  });

  it('formats full context with conversation transcript', () => {
    const formatted = formatContext(sampleContext, 'full');
    expect(formatted).toContain('# Context: Migration to PostgreSQL');
    expect(formatted).toContain('## Conversation');
    expect(formatted).toContain('**User:** What database should we use?');
    expect(formatted).toContain('**Assistant:** PostgreSQL with Supabase.');
  });
});
