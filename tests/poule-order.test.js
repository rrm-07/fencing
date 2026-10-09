import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boutOrder, createPoule, BOUT_ORDERS } from '../app/js/core/poule.js';

const fencers = (n) => Array.from({ length: n }, (_, i) => ({ id: `f${i + 1}`, name: `F${i + 1}` }));

for (let n = 3; n <= 8; n++) {
  test(`pool of ${n}: every pair fences exactly once`, () => {
    const order = boutOrder(n);
    assert.equal(order.length, (n * (n - 1)) / 2);
    const seen = new Map();
    for (const [a, b] of order) {
      assert.notEqual(a, b, 'nobody fences themselves');
      assert.ok(a >= 1 && a <= n && b >= 1 && b <= n, `positions in range: ${a}-${b}`);
      const key = [a, b].sort((x, y) => x - y).join('-');
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    for (let a = 1; a <= n; a++) {
      for (let b = a + 1; b <= n; b++) assert.equal(seen.get(`${a}-${b}`), 1, `pair ${a}-${b}`);
    }
  });

  test(`pool of ${n}: every fencer fences n-1 bouts`, () => {
    const count = new Array(n + 1).fill(0);
    for (const [a, b] of boutOrder(n)) {
      count[a]++;
      count[b]++;
    }
    for (let i = 1; i <= n; i++) assert.equal(count[i], n - 1);
  });
}

test('pools of 5–8: nobody fences two bouts in a row', () => {
  for (let n = 5; n <= 8; n++) {
    const order = boutOrder(n);
    for (let i = 1; i < order.length; i++) {
      const shared = order[i].filter((x) => order[i - 1].includes(x));
      assert.deepEqual(shared, [], `pool ${n}, bouts ${i} and ${i + 1}: ${order[i - 1]} / ${order[i]}`);
    }
  }
});

test('pools of 3 and 4: back-to-back bouts are kept to the unavoidable minimum', () => {
  // 3: every consecutive pair of bouts must share a fencer (only 3 fencers).
  // 4: with 2 bouts per "round" of 4 fencers, a repeat can't be avoided at round
  //    boundaries; check no fencer ever fences three in a row.
  for (const n of [3, 4]) {
    const order = boutOrder(n);
    for (let i = 2; i < order.length; i++) {
      const triple = order[i].filter((x) => order[i - 1].includes(x) && order[i - 2].includes(x));
      assert.deepEqual(triple, [], `pool ${n}: fencer fences three in a row at bout ${i + 1}`);
    }
  }
  const four = boutOrder(4);
  assert.deepEqual(four.slice(0, 2).flat().sort(), [1, 2, 3, 4], 'first two bouts use all four fencers');
});

test('rejects unsupported pool sizes', () => {
  assert.throws(() => boutOrder(2));
  assert.throws(() => boutOrder(9));
  assert.deepEqual(Object.keys(BOUT_ORDERS).map(Number), [3, 4, 5, 6, 7, 8]);
});

test('createPoule maps positions to fencer ids in table order', () => {
  const p = createPoule({ name: 'Club night', weapon: 'epee', fencers: fencers(5), now: 0 });
  assert.equal(p.bouts.length, 10);
  assert.equal(p.bouts[0].leftId, 'f1');
  assert.equal(p.bouts[0].rightId, 'f2');
  assert.equal(p.bouts[2].leftId, 'f5');
  assert.equal(p.bouts[2].rightId, 'f1');
  assert.deepEqual(
    p.bouts.map((b) => b.n),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  );
  assert.equal(p.status, 'active');
});
