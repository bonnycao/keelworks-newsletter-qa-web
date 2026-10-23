import express from 'express';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import ExcelJS from 'exceljs';
import dns from 'node:dns/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const app = express();
const port = process.env.PORT || 3000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.json({limit:'3mb'}));
app.use(express.static(path.join(__dirname,'public')));
const jobs = new Map();
const clean = v => String(v ?? '').replace(/[\u0000-\u001f]/g,' ').slice(0,2000);
const add = (arr,category,defect,description,solution,severity='Medium',viewport='All',status='Detected') => arr.push({id:`QA-${String(arr.length+1).padStart(3,'0')}`,category,defect,description:clean(description),solution,severity,viewport,status});
function privateIp(ip){
 if(net.isIP(ip)===4){const [a,b]=ip.split('.').map(Number);return a===0||a===10||a===127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a>=224||a===100&&b>=64&&b<=127;}
 if(net.isIP(ip)===6){const v=ip.toLowerCase();return v==='::1'||v==='::'||v.startsWith('fc')||v.startsWith('fd')||v.startsWith('fe8')||v.startsWith('fe9')||v.startsWith('fea')||v.startsWith('feb')||v.startsWith('::ffff:');}
 return true;
}
async function validateUrl(raw){
 let url;try{url=new URL(raw);}catch{throw new Error('Enter a valid URL.');}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Only public HTTP(S) URLs are allowed.');
 if(url.port&&!['80','443'].includes(url.port))throw new Error('Custom ports are not supported.');
 if(url.hostname==='localhost'||url.hostname.endsWith('.local')||net.isIP(url.hostname))throw new Error('Use a public website hostname.');
 const ips=await dns.lookup(url.hostname,{all:true});if(!ips.length||ips.some(x=>privateIp(x.address)))throw new Error('The address must resolve to a public server.');
 return url.href;
}
const designSystem = JSON.parse(
  readFileSync(
    path.join(__dirname, 'design-system', 'design-system.json'),
    'utf8'
  )
);

const specs = {
  body: designSystem.typography['Body/Regular'],
  h1: designSystem.typography['Heading/H1'],
  h2: designSystem.typography['Heading/H2']
};

const colorSpecs = {
  donateButton: {
    background: designSystem.donateButton.background.light,
    text: designSystem.donateButton.textColor
  },
  footer: {
    background: designSystem.footer.background,
    text: designSystem.footer.textColor
  }
};


// Content QA: deterministic local rules, plus optional locally hosted LanguageTool.
// No newsletter text is sent to third-party services by default.
const editorialRules = [
 {name:'Subject–verb agreement',pattern:/\bthese and (?:internet|the internet) access is limited\b/gi,fix:'Access to these computers and the internet is limited',why:'Plural/compound subject with singular verb; rewrite to clarify what is limited.',severity:'High'},
 {name:'Unclear participant count',pattern:/\b30 initial participants are less than ten\b/gi,fix:'Of the 30 initial participants, fewer than ten remain (confirm intended meaning)',why:'The number of participants is unclear; verify whether this refers to enrollment or attendance.',severity:'High'},
 {name:'Preposition usage',pattern:/\bessential with a virtual program\b/gi,fix:'essential for a virtual program',why:'“For” is the more natural preposition in this context.'},
 {name:'Hyphenation',pattern:/\bself identity\b/gi,fix:'self-identity',why:'Use conventional compound-noun hyphenation.'},
 {name:'Ambiguous wording',pattern:/\bKeelWorks is our interns\b/gi,fix:'Our interns are at the heart of KeelWorks',why:'The original statement may confuse readers; preserve the author’s intended meaning.'},
 {name:'Word choice',pattern:/\bgainful, sustaining employment\b/gi,fix:'gainful, sustainable employment (confirm intended meaning)',why:'“Sustainable” may better describe lasting employment.'},
 {name:'Parallel construction',pattern:/\bthe participant is able to attend regularly and that they understand\b/gi,fix:'participants can attend regularly and understand',why:'Use parallel verb phrases and consistent singular/plural references.'},
 {name:'Potential comma splice / coordination',pattern:/\bPriya brings us hope for better results and her influence\b/gi,fix:'Priya brings us hope for better results, and her influence',why:'A comma can separate two independent clauses joined by “and”.'},
 {name:'Editorial terminology',pattern:/\bfront-end analysis\b/gi,fix:'initial needs assessment (if that is the intended meaning)',why:'Specialized terminology may be unclear to newsletter readers.'},
 {name:'Informal word choice',pattern:/\bmore able to replicate\b/gi,fix:'better able to replicate',why:'A more idiomatic construction.'},
];
function checkEditorialContent(blocks, issues) {
 const seen = new Set();
 const flag=(category,defect,block,match,solution,reason,severity='Low')=>{
  const key=[category,defect,block.location,match].join('|');
  if(seen.has(key))return;seen.add(key);
  add(issues,category,defect,`${block.location} — Original: “${match}”. ${reason}`,
      solution,severity,'All','Needs Review');
 };
 for(const block of blocks){
  const text=block.text.replace(/\s+/g,' ').trim();if(!text)continue;
  for(const rule of editorialRules){
   for(const m of text.matchAll(rule.pattern))flag('Content / Grammar & clarity',rule.name,block,m[0],`Suggested: “${rule.fix}”.`,rule.why,rule.severity||'Medium');
  }
  for(const m of text.matchAll(/\b([a-z][a-z'-]*)\s+\1\b/gi))
   flag('Content / Repeated words','Repeated word',block,m[0],`Remove duplicated “${m[1]}” if unintended.`,'Possible accidental duplication.');
  for(const m of text.matchAll(/\s+[,.;!?]/g))
   flag('Content / Punctuation','Space before punctuation',block,m[0],'Remove the extra space.','Punctuation should follow the word directly.');
  for(const m of text.matchAll(/([!?])\1+/g))
   flag('Content / Punctuation','Repeated punctuation',block,m[0],'Use a single punctuation mark unless intentional.','Potentially inconsistent editorial style.');
  for(const m of text.matchAll(/\b(?:Keel\s+Master|Keel-Master)\b/gi))
   flag('Content / Terminology','KeelMaster spelling',block,m[0],'Use “KeelMaster” if referring to the approved program.','Verify approved program naming.');
  for(const m of text.matchAll(/\b(?:wifi|wi-fi|WiFi)\b/g))
   flag('Content / Terminology','Wi-Fi style',block,m[0],'Use “Wi-Fi” consistently.','Terminology consistency.');
 }
}

// Optional local LanguageTool server (see README). Deliberately limited to loopback.
async function checkLanguageTool(blocks, issues, notes){
 const endpoint=process.env.LANGUAGETOOL_URL;
 if(!endpoint){notes.push('Full dictionary-based spelling and grammar checking requires a local LanguageTool server; set LANGUAGETOOL_URL to enable it.');return;}
 let base;
 try{base=new URL(endpoint);if(!['localhost','127.0.0.1','[::1]'].includes(base.hostname)||base.protocol!=='http:')throw Error('Local HTTP only');}
 catch{notes.push('LANGUAGETOOL_URL must be a local HTTP address; LanguageTool skipped.');return;}
 let found=0;
 for(const block of blocks){
  if(!block.text.trim())continue;
  try{
   const body=new URLSearchParams({text:block.text,language:'en-US'});
   const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),5000);
   let response;
   try{response=await fetch(new URL('/v2/check',base),{method:'POST',body,signal:controller.signal});}
   finally{clearTimeout(timeout);}
   if(!response.ok)throw Error(`HTTP ${response.status}`);
   const result=await response.json();
   for(const match of (result.matches||[]).slice(0,15)){
    const original=block.text.slice(match.offset,match.offset+match.length);
    const suggestion=(match.replacements||[]).slice(0,2).map(x=>x.value).join(' / ');
    const type=match.rule?.issueType||'grammar';
    add(issues,`Content / ${type==='misspelling'?'Spelling':'Grammar'}`,match.message||'Language suggestion',
      `${block.location} — Original: “${original}”. Rule: ${match.rule?.id||'LanguageTool'}.`,
      suggestion?`Suggested: ${suggestion}`:'Review the text and rule explanation.',
      type==='misspelling'?'Medium':'Low','All','Needs Review');found++;
   }
  }catch(e){notes.push(`Local LanguageTool unavailable (${e.message}); local editorial checks still ran.`);return;}
 }
 notes.push(`Local LanguageTool returned ${found} suggestions; all require editorial review.`);
}

async function audit({url, html, filename}){
 const issues=[];const browser=await chromium.launch({headless:true});
 const summary={url: html ? `Uploaded HTML: ${filename}` : url,checkedAt:new Date().toISOString(),screens:[],checks:0,notes:['Typography and component color checks use the approved KeelWorks Newsletter Design System JSON reference.','Content QA uses local editorial patterns and optionally a locally hosted LanguageTool server. Contextual clarity suggestions require human review.','Automated accessibility testing cannot certify full WCAG compliance.']};
 try{
  for(const vp of [{name:'Desktop',width:1440,height:900},{name:'Tablet',width:768,height:1024},{name:'Mobile',width:390,height:844}]){
   const context=await browser.newContext({viewport:{width:vp.width,height:vp.height},deviceScaleFactor:1,ignoreHTTPSErrors:false});
   const page=await context.newPage();
   page.on('dialog',dialog=>dialog.dismiss().catch(()=>{}));
   await page.route('**/*', async route=>{
    const u=route.request().url();
    try{if(u.startsWith('data:') || u.startsWith('blob:')){await route.continue();return;} const dest=await validateUrl(u);if(dest)await route.continue();}catch{await route.abort();}
   });
   try{if(html){await page.setContent(html,{waitUntil:'domcontentloaded',timeout:25000});}else{await page.goto(url,{waitUntil:'domcontentloaded',timeout:25000});}await page.waitForTimeout(1200);}
   catch(e){add(issues,'Functionality','Page load failure',`${vp.name}: ${e.message}`,'Confirm the URL is accessible and the server responds correctly.','High',vp.name);await context.close();continue;}
   const data=await page.evaluate(({rules, approvedColors})=>{
    const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};
    const metric=e=>{const s=getComputedStyle(e);return {fontSize:parseFloat(s.fontSize),lineHeight:parseFloat(s.lineHeight),fontFamily:s.fontFamily,tag:e.tagName.toLowerCase(),text:e.textContent.trim().slice(0,65)}};
    const imgs=[...document.images].filter(visible).map(e=>({src:e.currentSrc||e.src,alt:e.getAttribute('alt'),complete:e.complete,naturalWidth:e.naturalWidth,naturalHeight:e.naturalHeight,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height,fit:getComputedStyle(e).objectFit}));
    const links=[...document.querySelectorAll('a[href]')].filter(visible).map(e=>({text:e.innerText.trim().slice(0,65),href:e.href}));
    const nowrapLinks=[...document.querySelectorAll('a')].filter(visible).filter(e=>getComputedStyle(e).whiteSpace==='nowrap').map(e=>e.textContent.trim().slice(0,80));
    const overflow=[...document.querySelectorAll('body *')].filter(visible).filter(e=>{const r=e.getBoundingClientRect();return r.right>innerWidth+3||r.left< -3}).slice(0,8).map(e=>({tag:e.tagName.toLowerCase(),className:String(e.className).slice(0,70)}));
     // Identify newsletter components conservatively; avoid matching unrelated elements.
     const colorValue = e => getComputedStyle(e).color;
     const backgroundValue = e => getComputedStyle(e).backgroundColor;
     const transparent = v => !v || v==='transparent' || v==='rgba(0, 0, 0, 0)';
     const coloredAncestor = (element, maxDepth=5) => {
       let node=element;
       for(let depth=0;node && depth<=maxDepth;depth++,node=node.parentElement){
         const bg=backgroundValue(node);
         if(!transparent(bg))return {element:node,background:bg};
       }
       return null;
     };
     const donateCandidates=[...document.querySelectorAll('a[href]')].filter(e=>
       visible(e) && /^donate$/i.test(e.textContent.trim()) &&
       /every\.org\/keelworks-foundation/i.test(e.href) &&
       /donateTo=keelworks-foundation/i.test(e.href)
     );
     const donation=donateCandidates.length===1 ? (()=>{
       const link=donateCandidates[0];
       const bg=coloredAncestor(link,3);
       return {background:bg?.background??null,text:colorValue(link)};
     })() : null;
     // Locate footer by its two legal links; find their common enclosing colored block.
     const legalLinks=[...document.querySelectorAll('a[href]')].filter(visible);
     const unsubscribe=legalLinks.find(e=>/unsubscribe/i.test(e.href)||/^mailto:.*unsubscribe/i.test(e.href));
     const privacy=legalLinks.find(e=>/privacy[_-]policy/i.test(e.href));
     let footer=null;
     if(unsubscribe && privacy){
       const ancestors=[];for(let e=unsubscribe;e;e=e.parentElement)ancestors.push(e);
       let common=privacy;while(common && !ancestors.includes(common))common=common.parentElement;
       if(common){
         const bg=coloredAncestor(common,8);
         if(bg)footer={background:bg.background,text:colorValue(bg.element)};
       }
     }
     const componentColors={donation,footer};
     const editorialBlocks=[...document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li')]
       .filter(visible).filter(e=>![...e.children].some(c=>/^(H[1-6]|P|LI)$/.test(c.tagName)))
       .map((e,i)=>({location:`${e.tagName.toLowerCase()} ${i+1}`,text:e.innerText||e.textContent||''}));
    return {title:document.title,imgs,links,overflow,nowrapLinks,componentColors,editorialBlocks,scrollWidth:document.documentElement.scrollWidth,viewportWidth:innerWidth,typography:Object.fromEntries(Object.keys(rules).map(k=>[k,[...document.querySelectorAll(k==='body'?'p':k)].filter(visible).slice(0,15).map(metric)])),headings:[...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(visible).map(e=>({level:Number(e.tagName[1]),text:e.textContent.trim().slice(0,65)}))};
   },{rules:specs,approvedColors:colorSpecs});
   if(vp.name==='Desktop'){checkEditorialContent(data.editorialBlocks,issues);await checkLanguageTool(data.editorialBlocks,issues,summary.notes);summary.checks+=data.editorialBlocks.length;}
   summary.screens.push({viewport:vp.name,width:vp.width,height:vp.height,title:data.title});
   summary.checks+=data.imgs.length+data.links.length+Object.values(data.typography).reduce((n,a)=>n+a.length,0);
    // Compare computed colors with the approved Design System values.
    const normalizeColor = value => {
      if(!value)return null;
      const v=String(value).trim().toLowerCase();
      if(/^#[0-9a-f]{6}$/.test(v))return v;
      if(/^#[0-9a-f]{3}$/.test(v))return '#'+[...v.slice(1)].map(c=>c+c).join('');
      const m=v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/);
      if(!m || (m[4]!==undefined && Number(m[4])!==1))return null;
      return '#'+m.slice(1,4).map(n=>Number(n).toString(16).padStart(2,'0')).join('');
    };
    for(const [key,label] of [['donation','Donate button'],['footer','Footer']]){
      const actual=data.componentColors[key];
      const expected=key==='donation'?colorSpecs.donateButton:colorSpecs.footer;
      if(!actual){
        if(vp.name==='Desktop')add(issues,'Colors',`${label} not confidently identified`,
          'The component could not be uniquely identified in the rendered newsletter.',
          'Review the newsletter markup and component identification before enforcing its colors.',
          'Low',vp.name,'Needs Review');
        continue;
      }
      for(const property of ['background','text']){
        const got=normalizeColor(actual[property]);
        const want=normalizeColor(expected[property]);
        if(!got || !want){
          add(issues,'Colors',`${label} ${property} color needs review`,
            `${vp.name}: computed ${property} color is ${actual[property]??'unavailable'}; approved ${expected[property]}.`,
            'Inspect the component and its inherited CSS colors.','Low',vp.name,'Needs Review');
        }else if(got!==want){
          add(issues,'Colors',`${label} ${property} color mismatch`,
            `${vp.name}: actual ${got}; approved ${want}.`,
            `Set the ${label.toLowerCase()} ${property} color to ${want} according to the Design System.`,
            'Medium',vp.name);
        }
      }
    }
   if(vp.name==='Mobile'&&data.nowrapLinks.length)add(issues,'Email compatibility','Non-wrapping links',`CSS white-space: nowrap affects ${data.nowrapLinks.length} visible link(s), potentially causing mobile overflow.`,'Allow long link text to wrap on narrow screens.','Medium',vp.name,'Needs Review');
   if(data.scrollWidth>vp.width+3)add(issues,'Layout','Horizontal page overflow',`${vp.name}: content width ${data.scrollWidth}px exceeds viewport ${vp.width}px.`,'Remove fixed-width overflow and test responsive containers.','High',vp.name);
   for(const o of data.overflow)add(issues,'Layout','Element extends outside viewport',`${vp.name}: <${o.tag}> ${o.className}`,'Inspect width, padding, positioning and responsive styles.','Medium',vp.name);
   for(const [tag,els] of Object.entries(data.typography))for(const e of els){const s=specs[tag];if(Math.abs(e.fontSize-s.fontSize)>1)add(issues,'Typography',`${tag.toUpperCase()} font size mismatch`,`${vp.name}: “${e.text}” uses ${e.fontSize}px; reference ${s.fontSize}px.`,'Apply the approved design-system typography token.','Medium',vp.name);
    if(Number.isFinite(e.lineHeight)&&Math.abs(e.lineHeight-s.lineHeight)>2)add(issues,'Typography',`${tag.toUpperCase()} line-height mismatch`,`${vp.name}: “${e.text}” uses ${e.lineHeight}px; reference ${s.lineHeight}px.`,'Apply the approved design-system line-height token.','Medium',vp.name);
   }
   for(const img of data.imgs){if(!img.complete||!img.naturalWidth)add(issues,'Images','Broken image',`${vp.name}: ${img.src}`,'Correct image URL or restore the asset.','High',vp.name);
    if(img.alt===null)add(issues,'Accessibility','Missing image alt attribute',`${vp.name}: ${img.src}`,'Provide meaningful alt text or alt="" for decorative images.','Medium',vp.name);
    if(img.naturalWidth&&img.naturalHeight&&img.width&&img.height){const natural=img.naturalWidth/img.naturalHeight,rendered=img.width/img.height;if(Math.abs(natural-rendered)/natural>0.08&&img.fit==='fill')add(issues,'Images','Potential image stretching',`${vp.name}: ${img.src} natural ratio ${natural.toFixed(2)}, displayed ratio ${rendered.toFixed(2)}.`,'Use height:auto to preserve intrinsic ratio, or object-fit:cover with intentional cropping.','High',vp.name);}
   }
   for(const link of data.links)if(link.href.startsWith('javascript:')||link.href==='#'||link.href.endsWith('/#'))add(issues,'Functionality','Placeholder link',`${vp.name}: “${link.text}” points to ${link.href}.`,'Replace with a valid destination or remove the nonfunctional link.','Medium',vp.name);
   let previous=0;for(const h of data.headings){if(previous&&h.level>previous+1)add(issues,'Accessibility','Skipped heading level',`${vp.name}: heading “${h.text}” jumps from H${previous} to H${h.level}.`,'Use logical heading hierarchy.','Medium',vp.name);previous=h.level;}
   if(vp.name==='Desktop'){
    try{const axe=await new AxeBuilder({page}).analyze();for(const v of axe.violations)for(const n of v.nodes.slice(0,12))add(issues,'Accessibility',v.help,`${v.id}: ${n.target.join(', ')}. ${v.description}`,v.helpUrl,v.impact==='critical'||v.impact==='serious'?'High':'Medium',vp.name);}catch(e){summary.notes.push('Accessibility scan did not complete: '+e.message);}
   }
   await context.close();
  }
 }finally{await browser.close();}
 const unique=new Map();for(const x of issues){const key=[x.category,x.defect,x.description,x.viewport].join('|');if(!unique.has(key))unique.set(key,x);}
 summary.issues=[...unique.values()].map((x,i)=>({...x,id:`QA-${String(i+1).padStart(3,'0')}`}));summary.count=summary.issues.length;return summary;
}
app.post('/api/audit',async(req,res)=>{
 try{
  const uploaded=req.body?.html;
  let source;
  if(typeof uploaded==='string'){
   if(!uploaded.trim() || uploaded.length>2000000)throw new Error('Choose an HTML file smaller than 2 MB.');
   const filename=String(req.body?.filename||'newsletter.html').slice(0,120);
   if(!/\.html?$/i.test(filename))throw new Error('Only .html and .htm files are supported.');
   const safeHtml=uploaded.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,'').replace(/<script\b[^>]*\/?>/gi,'');
   source={html:`<meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'">`+safeHtml,filename};
  }else{source={url:await validateUrl(req.body?.url)};}
  const result=await audit(source);const id=randomUUID();jobs.set(id,result);if(jobs.size>25)jobs.delete(jobs.keys().next().value);res.json({id,...result});}
 catch(e){res.status(400).json({error:clean(e.message)});}
});
app.get('/api/export/:id',async(req,res)=>{
 const result=jobs.get(req.params.id);if(!result)return res.status(404).send('Run a QA scan first.');
 const wb=new ExcelJS.Workbook();wb.creator='KeelWorks Newsletter QA';const ws=wb.addWorksheet('QA Defects',{views:[{state:'frozen',ySplit:1}]});
 ws.columns=[{header:'Defect ID',key:'id',width:13},{header:'Category',key:'category',width:21},{header:'Defect',key:'defect',width:36},{header:'Defect Description',key:'description',width:75},{header:'Change Solution',key:'solution',width:76},{header:'Severity',key:'severity',width:13},{header:'Viewport',key:'viewport',width:13},{header:'Status',key:'status',width:17}];
 ws.addRows(result.issues);ws.autoFilter={from:'A1',to:'H1'};ws.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};ws.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF263C63'}};ws.getRow(1).height=28;
 ws.eachRow((row,i)=>{if(i>1){row.alignment={vertical:'top',wrapText:true};row.height=44;if(i%2===0)row.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF1F5F9'}};}});
 const info=wb.addWorksheet('Scan Summary');info.addRows([['KeelWorks Newsletter QA Scan'],['Source',result.url],['Checked at',result.checkedAt],['Total findings',result.count],['Note','Automated results require human review.'],...result.notes.map(n=>['Limitation',n])]);info.getColumn(1).width=22;info.getColumn(2).width=110;info.getColumn(2).alignment={wrapText:true};
 res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition','attachment; filename="KeelWorks_Newsletter_QA.xlsx"');await wb.xlsx.write(res);res.end();
});
app.listen(port,()=>console.log(`KeelWorks QA ready at http://localhost:${port}`));
