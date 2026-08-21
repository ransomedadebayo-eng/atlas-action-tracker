import { describe,expect,it } from 'vitest';import{applyMarkdownCommand,documentHeadings,headingSlug,slashCommandAt}from'./documentEditor.js';
describe('document Markdown editor utilities',()=>{
  it('wraps selected text with inline formatting and links',()=>{expect(applyMarkdownCommand('hello',0,5,'bold')).toEqual({content:'**hello**',start:2,end:7});expect(applyMarkdownCommand('hello',0,5,'link').content).toBe('[hello](https://)')});
  it('inserts structural blocks and list prefixes',()=>{expect(applyMarkdownCommand('item',0,0,'checklist').content).toBe('- [ ] item');expect(applyMarkdownCommand('',0,0,'table').content).toContain('| Column |');expect(applyMarkdownCommand('code',0,4,'codeblock').content).toBe('```\ncode\n```')});
  it('builds stable unique heading slugs and positions',()=>{expect(headingSlug('API & Auth')).toBe('api-auth');expect(documentHeadings('# Intro\nText\n## API\n## API')).toEqual([{level:1,title:'Intro',slug:'intro',start:0,end:7},{level:2,title:'API',slug:'api',start:13,end:19},{level:2,title:'API',slug:'api-2',start:20,end:26}])});
  it('detects slash commands only in the current unspaced line fragment',()=>{expect(slashCommandAt('/tab',4)).toEqual({query:'tab',start:0,end:4});expect(slashCommandAt('Text /tab',9)).toBeNull();expect(slashCommandAt('/table more',11)).toBeNull()});
});
