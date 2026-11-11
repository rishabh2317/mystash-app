import assert from 'node:assert/strict';
import { it } from 'node:test';
import { assessFindMatches } from './findMatches';
import type { ReviewCandidate } from './similarity';
const hypothesis = { name:'Blue denim jacket',brand:null,model:null,category:'fashion',confidence:0.9,
  evidence:{identification:{version:1,kind:'possible'}} };
const candidate: ReviewCandidate = {title:'Levi blue denim jacket',brand:'Levi',model:null,category:'fashion',
  image:null,merchantUrl:'https://www.levi.com/p/12345678',merchant:'Levi',score:0.1,verifiedCatalogId:'catalog-a',pdpVerdict:'pdp',pdpScore:1};
it('generic visual hypotheses retain useful alternatives without calling them exact',()=>{
  const result=assessFindMatches(hypothesis,[candidate,{...candidate,merchantUrl:candidate.merchantUrl+'?merchant=2'}]);
  assert.equal(result.kind,'possible');assert.equal(result.suggestions.length,1);
  assert.equal(result.suggestions[0].kind,'similar_styles');
  assert.ok(result.suggestions[0].reasonCodes.includes('explicit_save_required'));
  assert.equal(assessFindMatches({...hypothesis,brand:'Levi'},[candidate]).suggestions[0].kind,'possible');
});
it('unsafe, discovery-only, wrong-type and contradictory-colour candidates remain unavailable',()=>{
  for(const bad of [{...candidate,merchantUrl:'http://127.0.0.1/product'}, {...candidate,verifiedCatalogId:undefined},
    {...candidate,title:'Levi blue denim jeans'}, {...candidate,title:'Levi black denim jacket'}, {...candidate,merchantUrl:'https://www.levi.com/search?q=jacket'}]) {
    assert.equal(assessFindMatches(hypothesis,[bad]).suggestions.length,0);
  }
});
it('no useful candidate retains the hypothesis rather than inventing a shopping link',()=>{
  assert.deepEqual(assessFindMatches(hypothesis,[]).suggestions,[]);
  assert.equal(assessFindMatches(hypothesis,[]).kind,'possible');
});
