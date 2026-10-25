// in-play-records.ts with ?relay=off: the page's address is read when state.ts loads, so
// this file sets it before loading the page's modules.
import { drawIntoNothing } from './fixtures/browser.ts';

import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import type { InPlayRecord } from '../src/shared/data.ts';
import { annVBobLive } from './fixtures/match.ts';

Object.assign(globalThis.location, { search: '?relay=off', href: 'http://localhost/?relay=off' });
drawIntoNothing();
const { recordsOf, refreshInPlay } = await import('../src/app/in-play-records.ts');
const st = await import('../src/app/state.ts');

describe('the win chance’s records with ?relay=off', () => {
  it('are data.json’s, and the relay isn’t asked', async () => {
    const asked = mock.method(globalThis, 'fetch', async () => Response.json({}));
    const built: InPlayRecord[] = [[1240, 650, 250, 11, 4]];
    const d = annVBobLive();
    d.matches.find((m) => m.gw === 3)!.inPlay = built;
    st.setData(d);
    st.state.route = { page: 'match', tab: 'facts', gw: 3, home: 1, away: 2 };
    assert.equal(st.LIVE_URL, '');
    assert.equal(recordsOf(st.D.matches.find((m) => m.gw === 3)!), built);
    await refreshInPlay();
    assert.equal(asked.mock.callCount(), 0);
  });
});
