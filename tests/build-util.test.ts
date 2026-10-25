import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { countBy, groupBy, mapPool, maxBy, parseArgs, range, round, sum } from '../src/build/util.ts';

describe('build helpers', () => {
  it('counts from one number to another, inclusive, and gives nothing backwards', () => {
    assert.deepEqual(range(3, 6), [3, 4, 5, 6]);
    assert.deepEqual(range(4, 4), [4]);
    assert.deepEqual(range(5, 4), []);
  });

  it('sums numbers, counting a missing one as nought', () => {
    assert.equal(sum([1, 2, null, undefined, 4]), 7);
    assert.equal(sum([]), 0);
  });

  it('rounds to a number of decimals', () => {
    assert.equal(round(1.23456, 2), 1.23);
    assert.equal(round(2.5, 0), 3);
    assert.equal(round(-1.25, 1), -1.2);
  });

  it('finds the item with the highest score, the first one on a tie, and nothing in an empty list', () => {
    const items = [
      { n: 'a', s: 1 },
      { n: 'b', s: 3 },
      { n: 'c', s: 3 },
    ];
    assert.equal(maxBy(items, (x) => x.s)?.n, 'b');
    assert.equal(maxBy(items, (x) => -x.s)?.n, 'a');
    assert.equal(
      maxBy([], () => 0),
      null,
    );
    assert.equal(
      maxBy(new Set([5, 9, 2]), (x) => x),
      9,
    );
  });

  it('groups and counts by a key', () => {
    const words = ['apple', 'avocado', 'banana', 'cherry', 'blueberry'];
    assert.deepEqual(
      groupBy(words, (w) => w[0]),
      { a: ['apple', 'avocado'], b: ['banana', 'blueberry'], c: ['cherry'] },
    );
    assert.deepEqual(
      countBy(words, (w) => w.length),
      { 5: 1, 6: 2, 7: 1, 9: 1 },
    );
  });

  it('runs every item through at most so many at a time', async () => {
    let running = 0;
    let most = 0;
    const done: number[] = [];
    await mapPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      running++;
      most = Math.max(most, running);
      await new Promise((r) => setImmediate(r));
      done.push(n);
      running--;
    });
    assert.equal(most, 3);
    assert.deepEqual(
      done.sort((a, b) => a - b),
      [1, 2, 3, 4, 5, 6, 7],
    );
    await mapPool([], 4, async () => assert.fail('nothing to run'));
  });

  it('reads --name value pairs and bare flags from the command line', () => {
    assert.deepEqual(parseArgs(['--league', '123', '--archive', '--cache', '.cache', 'stray']), {
      league: '123',
      archive: true,
      cache: '.cache',
    });
    assert.deepEqual(parseArgs(['--archive', '--out', 'x.json']), { archive: true, out: 'x.json' });
    assert.deepEqual(parseArgs(['--last']), { last: true });
  });
});
