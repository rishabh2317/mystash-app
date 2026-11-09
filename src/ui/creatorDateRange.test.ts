import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { creatorRangeDays, lastCompleteUtcDay, shiftUtcDay, utcDay, validateCreatorDateRange } from './creatorDateRange';

const now = new Date('2026-11-09T00:20:00Z');
describe('creator custom date ranges', () => {
  it('uses inclusive selected UTC days and an exclusive request boundary', () => {
    assert.equal(lastCompleteUtcDay(now), '2026-11-08');
    assert.equal(shiftUtcDay('2026-11-08', 1), '2026-11-09');
    assert.equal(creatorRangeDays({ start: '2026-11-01', end: '2026-11-08' }), 8);
    assert.equal(validateCreatorDateRange({ start: '2026-11-01', end: '2026-11-08' }, now), null);
  });
  it('rejects invalid dates, reversed ranges, today/future and overlong selections', () => {
    assert.equal(utcDay('2026-02-30'), null);
    assert.match(validateCreatorDateRange({ start: '2026-11-08', end: '2026-11-01' }, now)!, /end date/);
    assert.match(validateCreatorDateRange({ start: '2026-11-01', end: '2026-11-09' }, now)!, /completed day/);
    assert.match(validateCreatorDateRange({ start: '2026-08-01', end: '2026-11-08' }, now)!, /90 days/);
  });
});
