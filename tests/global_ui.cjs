const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const {parseHTML}=require('linkedom');
const ROOT=path.join(__dirname,'../global');
const {window}=parseHTML(fs.readFileSync(path.join(ROOT,'index.html'),'utf8')),document=window.document;
Object.defineProperty(window.HTMLSelectElement.prototype,'value',{get(){return this._value??(this.querySelector('option[selected]')||this.querySelector('option'))?.value??''},set(v){this._value=String(v)},configurable:true});
const location={hash:'',href:'https://example.org/global/'};const requests=[];
const context=vm.createContext({document,window,location,history:{replaceState(a,b,hash){location.hash=hash}},navigator:{clipboard:{writeText:async()=>{}}},maplibregl:{Map:function(){throw Error('Test accessible no-WebGL mode')}},URL,URLSearchParams,Blob,setTimeout,console,fetch:async p=>{requests.push(p);return {ok:true,json:async()=>JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'))}}});
context.AtlasModel=require(path.join(ROOT,'model.js'));const run=s=>vm.runInContext(s,context);
run(fs.readFileSync(path.join(ROOT,'app.js'),'utf8'));
(async()=>{
 for(let i=0;i<30&&!document.querySelector('#locations a');i++)await new Promise(r=>setTimeout(r,5));
 assert(document.querySelector('#locations a'));assert(!requests.some(r=>r.includes('/observations/')),'World must not load regional observations');
 console.log('World initial requests:',requests.length);
 async function route(hash){location.hash=hash;await run('render()');assert(!document.querySelector('#status').classList.contains('error'),document.querySelector('#status').textContent)}
 await route('#/country/JP?crop=wheat');assert(document.querySelector('#title').textContent==='Japan');assert(document.querySelectorAll('#locations a').length===47);assert.equal(document.querySelectorAll('#crop option').length,2);assert(!requests.some(r=>r.includes('/observations/')));
 await route('#/region/JP/JP.ADM1.00001?crop=wheat');assert(document.querySelectorAll('#detail circle').length===18);assert.equal(document.querySelectorAll('#detail tbody tr').length,18);
 assert.equal(run('detailSeries.periods.available.n'),18);
 await route('#/region/JP/JP.ADM1.00001?crop=wheat&period=2015-2024');assert.equal(document.querySelectorAll('#detail tbody tr').length,run('detailSeries.periods[state.period].n'));
 await route('#/country/DE?crop=wheat');assert(document.querySelector('#subtitle').textContent.includes('not yet included'));assert.equal(document.querySelectorAll('#locations a').length,0);
 await route('#/region/IN/IN.ADM2.00001?crop=wheat&season=Summer');assert(!document.querySelector('#detail').hidden);
 const cat=JSON.parse(fs.readFileSync(path.join(ROOT,'data/2026-09-26/catalog.json')));
 let cases=0;
 for(const [c,data] of Object.entries(cat.countries))for(const [crop,seasons] of Object.entries(data.crops))for(const season of seasons){
   await route('#/country/'+c+'?'+new URLSearchParams({crop,season}));cases++;assert.equal(run('selected.every(r=>r.season===state.season)'),true);
 }
 await route('#/country/MY?crop=rice-paddy&basis=planted');assert(run('selected.every(r=>r.basis==="planted")'));
 await route('#/country/MY?crop=rice-paddy&basis=harvested');assert(run('selected.every(r=>r.basis==="harvested")'));
 await route('#/country/JP?crop=wheat&minimum=80&period=2015-2024');assert(run('selected.filter(r=>r.enough).every(r=>r.stats.completeness>=.8)'));
 await route('#/country/IN?crop=wheat');assert(run('selected.filter(r=>r.country==="IN").every(r=>r.season==="Rabi")'));
 console.log('PASS: '+cases+' country/crop/season routes, region chart and table, fixed periods, missing countries, separate denominators, coverage screen, lazy observation loads.');
})().catch(e=>{console.error(e);process.exitCode=1});
