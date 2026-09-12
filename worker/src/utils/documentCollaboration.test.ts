import { describe, expect, it } from 'vitest';
import { applyTextChange, changeSummary, mergeDocumentChanges, singleTextChange, transformIndex } from './documentCollaboration';

describe('document single-change diff',()=>{
  it('detects insertion, deletion, and replacement ranges',()=>{
    expect(singleTextChange('hello','hello world')).toEqual({start:5,end:5,insert:' world'});
    expect(singleTextChange('hello world','hello')).toEqual({start:5,end:11,insert:''});
    expect(singleTextChange('hello world','hello Atlas')).toEqual({start:6,end:11,insert:'Atlas'});
  });
  it('applies and summarizes a change deterministically',()=>{const change={start:2,end:4,insert:'XYZ'};expect(applyTextChange('abcdef',change)).toBe('abXYZef');expect(changeSummary(change)).toEqual({start:2,delete_count:2,insert_count:3})});
});

describe('three-way document merge',()=>{
  const base={baseTitle:'Plan',baseContent:'alpha\nbeta\ngamma'};
  it('applies a direct edit when canonical content is unchanged',()=>{expect(mergeDocumentChanges({...base,currentTitle:'Plan',currentContent:base.baseContent,proposedTitle:'Plan v2',proposedContent:'alpha\nBETA\ngamma'})).toMatchObject({ok:true,title:'Plan v2',content:'alpha\nBETA\ngamma',strategy:'direct'})});
  it('merges disjoint canonical and proposed changes',()=>{expect(mergeDocumentChanges({...base,currentTitle:'Plan',currentContent:'ALPHA\nbeta\ngamma',proposedTitle:'Plan',proposedContent:'alpha\nbeta\nGAMMA'})).toMatchObject({ok:true,content:'ALPHA\nbeta\nGAMMA',strategy:'three_way'})});
  it('preserves both concurrent insertions at the same point in canonical-first order',()=>{expect(mergeDocumentChanges({baseTitle:'Plan',baseContent:'ab',currentTitle:'Plan',currentContent:'aXb',proposedTitle:'Plan',proposedContent:'aYb'})).toMatchObject({ok:true,content:'aXYb',strategy:'three_way'})});
  it('rejects overlapping replacements without overwriting canonical content',()=>{expect(mergeDocumentChanges({...base,currentTitle:'Plan',currentContent:'alpha\nCURRENT\ngamma',proposedTitle:'Plan',proposedContent:'alpha\nPROPOSED\ngamma'})).toMatchObject({ok:false,reason:'overlapping_change'})});
  it('rejects conflicting title edits',()=>{expect(mergeDocumentChanges({...base,currentTitle:'Current title',currentContent:base.baseContent,proposedTitle:'Proposed title',proposedContent:base.baseContent})).toMatchObject({ok:false,reason:'title_conflict'})});
  it('retains canonical text for no-op and identical proposed changes',()=>{expect(mergeDocumentChanges({...base,currentTitle:'Plan',currentContent:'alpha\nBETA\ngamma',proposedTitle:'Plan',proposedContent:base.baseContent})).toMatchObject({ok:true,content:'alpha\nBETA\ngamma'});expect(mergeDocumentChanges({...base,currentTitle:'Plan',currentContent:'alpha\nBETA\ngamma',proposedTitle:'Plan',proposedContent:'alpha\nBETA\ngamma'})).toMatchObject({ok:true,content:'alpha\nBETA\ngamma'})});
  it('transforms cursor positions around accepted concurrent changes',()=>{expect(transformIndex(5,{start:1,end:1,insert:'abc'})).toBe(8);expect(transformIndex(5,{start:2,end:7,insert:'x'})).toBe(3);expect(transformIndex(1,{start:1,end:1,insert:'abc'})).toBe(4)});
});
