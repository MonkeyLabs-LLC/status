import {afterEach,expect,it,vi} from 'vitest';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {getMonitorProjection} from './lib/status-client';
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
it.each(['','false'])('missing native origin fails closed with retired optout %j',async flag=>{
 vi.stubEnv('STATUS_REQUIRE_NATIVE_OWNERS',flag);vi.stubEnv('STATUS_API_URL','');
 const transport=vi.fn();vi.stubGlobal('fetch',transport);
 await expect(getMonitorProjection()).rejects.toMatchObject({status:503});expect(transport).not.toHaveBeenCalled();
});
it('current route import closure cannot reach the retired SQL or quorum backend',()=>{
 const root=dirname(fileURLToPath(import.meta.url));const visited=new Set<string>();
 function files(dir:string):string[]{return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(resolve(dir,e.name)):[resolve(dir,e.name)]);}
 function follow(file:string){if(visited.has(file))return;visited.add(file);
  expect(file).not.toMatch(/\/lib\/(?:quorum|db-incidents|db-maintenance|sources|subscribers|notify)\.ts$|\/db\/index\.ts$/);
  let source=readFileSync(file,'utf8');if(file.endsWith('.astro'))source=source.match(/^---\n([\s\S]*?)\n---/)?.[1]??'';
  const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
  for(const node of ast.statements){if(!ts.isImportDeclaration(node)||!ts.isStringLiteral(node.moduleSpecifier))continue;
   const clause=node.importClause;if(clause?.isTypeOnly)continue;if(clause?.namedBindings&&ts.isNamedImports(clause.namedBindings)&&clause.namedBindings.elements.every(e=>e.isTypeOnly))continue;
   const spec=node.moduleSpecifier.text;expect(spec).not.toMatch(/^(?:postgres|drizzle-orm)(?:\/|$)/);
   if(!spec.startsWith('.')&&!spec.startsWith('@/'))continue;
   const base=spec.startsWith('@/')?resolve(root,spec.slice(2)):resolve(dirname(file),spec);
   const target=[base,base+'.ts',base+'.astro',resolve(base,'index.ts')].find(x=>{try{return readFileSync(x).length>=0}catch{return false}});if(target)follow(target);
  }
 }
 for(const file of [...files(resolve(root,'pages')).filter(x=>/\.(?:ts|astro)$/.test(x)&&!x.includes('.test.')),resolve(root,'middleware.ts')])follow(file);
 expect(visited.size).toBeGreaterThan(50);
 // Auth decisions remain Go-owned; existing Resend presentation/transport stays a thin host adapter.
 expect(visited.has(resolve(root,'lib/email.ts'))).toBe(true);
 expect(readFileSync(resolve(root,'lib/email.ts'),'utf8')).toContain('https://api.resend.com/emails');
});
