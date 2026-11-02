import {test} from 'node:test';
import assert from 'node:assert/strict';
import fixture from '../../product-intelligence/search/testing/creatorBatCandidates.json';
import {rankPdpCandidates} from '../../product-intelligence/search/PdpRanker';
import {assessSimilar} from './similarity';
test('recorded discovery-only merchant cache remains non-confirming and exact ranks stay unchanged',()=>{
 const frozen=JSON.stringify(fixture);
 const before=rankPdpCandidates(fixture.candidates,fixture.expected);
 const result=assessSimilar({...fixture.expected,confidence:0.99},fixture.candidates);
 assert.equal(result.kind,'unable_to_identify'); // Discovery snippets are not verified merchant evidence.
 assert.deepEqual(rankPdpCandidates(fixture.candidates,fixture.expected),before);
 assert.equal(JSON.stringify(fixture),frozen);
 // The replay invokes only pure functions; no search/enrichment/reasoner dependency exists.
});
