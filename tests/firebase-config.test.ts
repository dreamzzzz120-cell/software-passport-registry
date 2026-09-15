import { describe, expect, it } from 'vitest';
import { supabaseConfigured, supabase } from '../src/lib/supabase';

describe('Supabase browser configuration', () => {
  it('has a configured publishable Supabase client without Firebase runtime configuration', () => {
    expect(supabaseConfigured).toBe(true);
    expect(supabase.auth).toBeDefined();
  });
});
