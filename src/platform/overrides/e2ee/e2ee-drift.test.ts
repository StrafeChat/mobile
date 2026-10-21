/**
 * machine.ts and keyBackup.ts are copies of the web's lib/e2ee modules (the e2ee area of
 * ../upstream.json), and keyBackup's unwrap and import flows also live in the crypto host page
 * (crypto-host/src/backup.ts). A web fix to either - security fixes land here - reaches the
 * app only when someone ports it, so a submodule bump that changes one fails here until it
 * has been ported and the hash updated. The checks are ../check-drift.cjs's, which
 * `npm run check:e2ee-drift` runs too.
 */
import { describe, expect, it } from '@jest/globals';
import { checkCoverage, checkHashes } from '../check-drift.cjs';

describe('E2EE overrides vs web sources', () => {
  for (const result of checkHashes('e2ee')) {
    it(`web/src/${result.rel} is the version the override was written against`, () => {
      if (!result.ok) throw new Error(result.message);
      expect(result.ok).toBe(true);
    });
  }

  it('every lib/e2ee and stores/e2ee* override is pinned', () => {
    expect(checkCoverage('e2ee')).toEqual([]);
  });
});
