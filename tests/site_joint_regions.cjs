// Verify the forecast's actual ENSO coordinate, joint boundaries and legacy view.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {parseHTML}=require('linkedom');
const source=fs.readFileSync(require('node:path').join(__dirname,'../site/app.js'),'utf8');
const start=source.indexOf('function niceTicks('),end=source.indexOf('// ----',start);
const context={fmt:(x,n=1)=>Number(x).toFixed(n),esc:x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')};
vm.runInNewContext(source.slice(start,end)+'\nthis.chart=rowChart;this.outline=jointOutline;',context);
const joint={center:[1.5,-5],shape:[.25,-.7,9],q80:3.2,q95:6,bounds95:[1.5-Math.sqrt(1.5),1.5+Math.sqrt(1.5),-5-Math.sqrt(54),-5+Math.sqrt(54)],scope:'conditional effect',issue_date:'2026-10-08'};
const options={mode:'enso',jointMode:true,joint,x0:-2,x1:4,hy:2026,points:[{x:0,y:0,year:2001,label:'2001'}],xLabel:'ENSO',yLabel:'Yield anomaly (%)',reader:true,width:480,height:180,forecast:{x:1.5,y:-5,label:'Current prediction'},sofarReadout:'Season to date: +1 °C, through October 10'};
const document=parseHTML(context.chart(options)).document;
assert.equal(document.querySelectorAll('.joint-region').length,2);
assert.equal(document.querySelectorAll('.joint-region[tabindex="0"]').length,2);
assert.equal(document.querySelectorAll('.season-readout').length,1);
assert(![...document.querySelectorAll('svg text')].some(x=>x.textContent==='2026'),'no separate year strip');
const diamond=document.querySelector('polygon.pt.open');
const x=Number(diamond.getAttribute('points').split(' ')[0].split(',')[0]);
assert(Math.abs(x-(48+(1.5+2)/6*(480-48-12)))<.001,'diamond sits at forecast ENSO exposure');
for(const polygon of document.querySelectorAll('.joint-region'))for(const pair of polygon.getAttribute('points').split(' ')){
  const [x,y]=pair.split(',').map(Number);assert(Number.isFinite(x)&&Number.isFinite(y));assert(x>=48&&x<=468&&y>=23&&y<=144,'region fits inside plot');
}
const segment={...joint,center:[1,-3],shape:[0,0,4]};
assert(context.outline(segment,95).every(p=>p[0]===1),'fixed ENSO is a vertical region');
const old=parseHTML(context.chart({...options,jointMode:false,joint:null,sofarReadout:null})).document;
assert([...old.querySelectorAll('svg text')].some(x=>x.textContent==='2026'),'archived releases retain their strip');
const history=parseHTML(context.chart({...options,mode:'year',joint:null,x0:1980,x1:2027})).document;
assert.equal(history.querySelectorAll('.joint-region').length,0);
const ndvi=parseHTML(context.chart({...options,joint:null,forecast:null,yLabel:'NDVI',points:[{x:-1,y:-.006,year:2000,label:'2000'},{x:1,y:.006,year:2001,label:'2001'}]})).document;
const labels=[...ndvi.querySelectorAll('text[text-anchor="end"]')].map(x=>x.textContent);
assert.equal(new Set(labels).size,labels.length,'small NDVI ticks remain numerically distinct');
assert(labels.some(x=>Math.abs(Number(x))>0&&Math.abs(Number(x))<.01),'small NDVI values retain decimal precision');
console.log('PASS joint regions: calibrated coordinates, nesting geometry, accessibility, degeneracy, and archived display.');
