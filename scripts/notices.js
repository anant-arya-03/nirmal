import { readFileSync, readdirSync, existsSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
const lock=JSON.parse(readFileSync('package-lock.json','utf8'));
const entries=[];
for(const path of Object.keys(lock.packages).filter(p=>p.startsWith('node_modules/')).sort()) {
  if(!existsSync(join(path,'package.json')))continue;
  const p=JSON.parse(readFileSync(join(path,'package.json'),'utf8'));
  const files=readdirSync(path).filter(f=>/^(licen[cs]e|copying|copyright|notice|third.party)/i.test(f));
  const texts=[];
  for(const file of files){try{texts.push(`${file}\n${readFileSync(join(path,file),'utf8')}`);}catch{}}
  // Preserve any additional notices shipped inside common package subdirectories.
  for(const sub of ['lib','vendor','lib/glib-2.0/include'])if(existsSync(join(path,sub)))for(const file of readdirSync(join(path,sub)).filter(f=>/^(licen[cs]e|copying|copyright|notice|third.party)/i.test(f)))try{texts.push(`${sub}/${file}\n${readFileSync(join(path,sub,file),'utf8')}`);}catch{}
  if(p.name.startsWith('@rolldown/binding-') && !texts.length) {
    for(const file of ['LICENSE','THIRD-PARTY-LICENSE']) if(existsSync(join('node_modules/rolldown',file))) texts.push(`Notice from the matching rolldown parent package: ${file}\n${readFileSync(join('node_modules/rolldown',file),'utf8')}`);
  }
  entries.push(`## ${p.name}@${p.version}\nDeclared license: ${typeof p.license==='string'?p.license:JSON.stringify(p.license||'NOT DECLARED')}\nInstalled path: ${path}\nSource: ${typeof p.repository==='string'?p.repository:p.repository?.url||p.homepage||'See package metadata'}\n\n${texts.length?texts.join('\n\n'):'No separate root notice found in the installed package; consult its declared license and upstream source.'}`);
}
const output=`# Nirmal — third-party notices\n\nGenerated from the installed, locked dependencies. Includes runtime and development packages present on this platform. Licenses remain owned by their respective holders. Do not remove package notices when redistributing. Regenerate on every dependency or platform change with npm run licenses.\n\n${entries.join('\n\n---\n\n')}\n`;
writeFileSync('THIRD_PARTY_NOTICES.md',output);
if(existsSync('dist'))copyFileSync('THIRD_PARTY_NOTICES.md','dist/third-party-notices.txt');
console.log(`Preserved notices for ${entries.length} installed packages.`);
