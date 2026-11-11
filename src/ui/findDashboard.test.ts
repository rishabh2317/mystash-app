import {test} from 'node:test';
import assert from 'node:assert/strict';
import {findActivityExpanded,findActivityProgress,findActivityRevision,selectFindActivity} from './findDashboard';
import {findFixture} from './findTestFixtures';
test('activity prioritizes active work and falls back to the newest completed or attention Find',()=>{
  const completed=findFixture(1),active=findFixture(4,'processing'),failed=findFixture(2,'attention');
  assert.equal(selectFindActivity([active],[completed,failed],[completed])?.id,active.id);
  assert.equal(selectFindActivity([],[completed,failed],[completed])?.id,completed.id);
  failed.createdAt='2099-01-01T00:00:00Z';assert.equal(selectFindActivity([],[failed,completed],[completed])?.id,completed.id);
  assert.equal(selectFindActivity([],[failed,completed],[completed],true)?.id,failed.id);
  assert.equal(selectFindActivity([],[],[]),null);
});
test('activity defaults and user choices respect state and identity',()=>{
  const completed=findFixture(1),active=findFixture(2,'processing'),failed=findFixture(3,'attention');
  assert.equal(findActivityExpanded(completed,null),false);assert.equal(findActivityExpanded(active,null),true);assert.equal(findActivityExpanded(failed,null),false);
  assert.equal(findActivityExpanded(active,{id:active.id,expanded:false}),false);
  assert.equal(findActivityExpanded(completed,{id:active.id,expanded:true}),false);
});
test('Activity reports real product/place branch progress without synthetic percentages',()=>{
  const active=findFixture(2,'processing');
  assert.deepEqual(findActivityProgress(active),['Products: 2 found, still looking','Places: 1 found']);
  const revision=findActivityRevision(active);
  active.outcome={...active.outcome,foundProducts:3,products:'complete'};
  assert.notEqual(findActivityRevision(active),revision);
  assert.deepEqual(findActivityProgress(active),['Products: 3 found','Places: 1 found']);
});
