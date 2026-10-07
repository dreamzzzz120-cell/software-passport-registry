import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Q-LEGION command center', () => {
  const route = readFileSync(resolve(process.cwd(), 'src/routes/q-legion.ts'), 'utf8');
  const panel = readFileSync(resolve(process.cwd(), 'src/components/FounderQLegionPanel.tsx'), 'utf8');
  const growthRoute = readFileSync(resolve(process.cwd(), 'src/routes/distribution-growth.ts'), 'utf8');
  const growthUi = readFileSync(resolve(process.cwd(), 'src/components/FounderGrowthHub.tsx'), 'utf8');

  it('reports strategy performance from observed outreach outcomes', () => {
    expect(route).toContain('strategyPerformance');
    expect(route).toContain('q_legion_strategy_id');
    expect(route).toContain('c.replied_at');
    expect(route).toContain('c.demo_at');
    expect(route).toContain('c.checkout_at');
    expect(route).toContain('c.customer_at');
    expect(route).toContain('recommendedNextMove');
  });

  it('shows the strategy leaderboard and full observed funnel', () => {
    expect(panel).toContain('Strategy leaderboard');
    expect(panel).toContain('Checkouts');
    expect(panel).toContain('Customers');
    expect(panel).toContain('Next best move');
    expect(panel).toContain('Red-team blockers');
  });

  it('keeps checkout separate in the founder growth pipeline', () => {
    expect(growthRoute).toContain("'demo','checkout','pilot'");
    expect(growthRoute).toContain("checkout_at=CASE WHEN $3='checkout'");
    expect(growthUi).toContain("checkout:'Checkout'");
  });
});
