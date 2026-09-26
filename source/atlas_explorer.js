// Scenario calculations use each panel's existing monthly exposure window.
const modelColors=['#20292c','#2166ac','#d87919'];
const modelNames=['Linear','Quadratic','Warm/cold slopes'];
const scenarioControls=document.createElement('section');
scenarioControls.className='card';scenarioControls.style.margin='16px 0';
scenarioControls.innerHTML=`<h2>ENSO scenario</h2><div class="controls" style="position:static;border:0;padding:0">
<label>Exposure assumption<select id="scenarioMode"><option value="profile">1997–98 monthly shape, scaled to peak</option><option value="direct">Direct crop-season average</option></select></label>
<label id="amplitudeLabel">Peak / average Niño 3.4 (°C)<input id="amplitude" type="number" min="0" max="5" step="0.1" value="3"></label>
<label>Peak year<input id="peakYear" type="number" min="1900" max="2200" value="2026"></label>
<label>Crop reporting year<select id="cropYearOffset"><option value="-1">Year before peak</option><option value="0" selected>Year of peak</option><option value="1">Year after peak</option></select></label>
<label>Map view<select id="mapView"><option value="scenario">Scenario yield responses</option><option value="diagnostic">Sensitivity and validation</option></select></label>
<label>Scenario color range<select id="colorRange"><option value="10">−10% to +10%</option><option value="20" selected>−20% to +20%</option><option value="50">−50% to +50%</option><option value="100">−100% to +100%</option></select></label>
<button id="downloadScenario">Download scenario estimates (CSV)</button></div>
<p id="scenarioNote"></p><details id="pathDetails"><summary>Monthly ENSO scenario and crop window</summary><svg id="scenarioPath" viewBox="0 0 1050 200" style="width:100%;max-height:220px"></svg></details>
<p class="muted">Responses compare the same year with neutral ENSO (Niño 3.4 = 0). The historical profile is an assumed event shape, not a forecast. Dashed curves mark exposures beyond the unit’s observed range. Estimates have no uncertainty intervals; nonlinear models are shown whether or not they pass validation.</p>`;
$('maps').before(scenarioControls);
const history=document.createElement('section');history.className='card';history.style.marginTop='16px';
history.innerHTML=`<h2>Yield observations and fit</h2><div class="controls" style="position:static;border:0;padding:0"><label>Model for data comparison<select id="dataModel"><option value="0">Linear</option><option value="1">Quadratic</option><option value="2">Warm/cold slopes</option></select></label><label>Yield view<select id="dataView"><option value="adjusted">Adjusted for the selected model’s time trend</option><option value="raw">Actual yield (t/ha)</option></select></label></div>
<p id="historyNote" class="muted"></p><div class="grid"><div><h3>Yield against Niño 3.4</h3><p id="scatterLegend" class="model-key"></p><svg id="scatter" viewBox="0 0 550 310" style="width:100%"></svg></div><div><h3>Yield through time</h3><svg id="timeYield" viewBox="0 0 550 240" style="width:100%"></svg><h3>Crop-season ENSO exposure</h3><svg id="timeEnso" viewBox="0 0 550 165" style="width:100%"></svg></div></div><p class="muted">Dots are the observations used in the fits, including the documented East Java correction. Hover for year and values. Colored lines show the selected model; time-series predictions use each year’s observed ENSO. These are in-sample fits. Gaps in annual observations are not joined.</p>`;
$('unit-section').append(history);history.className='';history.style.marginTop='12px';
const coverage=document.createElement('details');coverage.className='card';coverage.innerHTML='<summary>Crop coverage and excluded records</summary><p id="coverageNote"></p><div class="coverage-table"><table><thead><tr><th>Country</th><th>Season</th><th>Source units</th><th>Fitted</th><th>Under 20 years</th><th>Other exclusions</th><th>Complete years</th></tr></thead><tbody id="coverageRows"></tbody></table></div>';scenarioControls.before(coverage);
const originalFields=fields.map(v=>v.slice());
function scenario(){
 const amplitude=$('amplitude').value===''?NaN:Number($('amplitude').value), year=$('peakYear').value===''?NaN:Number($('peakYear').value), offset=Number($('cropYearOffset').value);
 if(!Number.isFinite(amplitude)||amplitude<0||amplitude>5||!Number.isInteger(year)||year<1900||year>2200)return {x:null,months:[],year};
 const months=[];
 for(let m=current.start_relative_month;m<=current.end_relative_month;m++){
   const z=12*(1997+offset)+(m-1), y=Math.floor(z/12), mon=z%12+1;
   const value=D.eventProfile.values[y+'-'+String(mon).padStart(2,'0')];
   months.push({relative:12*offset+m-1,value:value===undefined?null:value*amplitude/D.eventProfile.peak});
 }
 const direct=$('scenarioMode').value==='direct';
 return {x:direct?amplitude:months.every(m=>m.value!==null)?months.reduce((s,m)=>s+m.value,0)/months.length:null,months,year,offset,amplitude,direct};
}
function response(r,x,j){if(x===null)return null;return 100*Math.expm1(j===0?r.beta*x:j===1?r.quadratic_beta*x+r.curvature*x*x:(x<0?r.cold_beta:r.warm_beta)*x)}
function download(text,name,type){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function plotFrame(svg,xmin,xmax,ymin,ymax,xlabel,ylabel,height=310){
 svg.replaceChildren();if(xmax===xmin)xmax=xmin+1;if(ymax===ymin){ymax+=.5;ymin-=.5}
 const pad=(ymax-ymin)*.08;ymin-=pad;ymax+=pad;
 const X=x=>62+(x-xmin)/(xmax-xmin)*466,Y=y=>height-45-(y-ymin)/(ymax-ymin)*(height-78);
 for(let i=0;i<5;i++){const y=ymin+(ymax-ymin)*i/4;svg.append(svgEl('line',{x1:62,x2:528,y1:Y(y),y2:Y(y),stroke:'#e5ebe8'}));label(svg,fmt(y),55,Y(y)+4,{'text-anchor':'end'});const x=xmin+(xmax-xmin)*i/4;label(svg,xlabel.includes('year')?String(Math.round(x)):fmt(x),X(x),height-25,{'text-anchor':'middle'})}
 label(svg,xlabel,295,height-5,{'text-anchor':'middle'});label(svg,ylabel,62,16);return {X,Y};
}
function dot(svg,x,y,tip,color='#657773',radius=3){const e=svgEl('circle',{cx:x,cy:y,r:radius,fill:color,'fill-opacity':.7});const t=svgEl('title');t.textContent=tip;e.append(t);svg.append(e)}
function line(svg,points,X,Y,color,dashed=false){if(!points.length)return;svg.append(svgEl('path',{d:points.map((p,i)=>(i?'L':'M')+X(p[0])+','+Y(p[1])).join(''),fill:'none',stroke:color,'stroke-width':2,'stroke-dasharray':dashed?'5 4':''}))}
function drawHistory(){
 if(!selected){for(const id of ['scatter','timeYield','timeEnso'])$(id).replaceChildren();$('historyNote').textContent='Select a unit with an eligible fit.';$('scatterLegend').textContent='';return}
 const r=selected,key=r.panel+'|'+r.stable_id,obs=D.observations[key],j=Number($('dataModel').value),b=D.fits[key][j],adjusted=$('dataView').value==='adjusted';
 const effect=x=>j===0?b[2]*x:j===1?b[2]*x+b[3]*x*x:b[2]*x+b[3]*Math.max(x,0);
 const base=year=>b[0]+b[1]*(year-2000)/10;
 const values=obs.map(o=>adjusted?100*Math.expm1(o[2]-base(o[0])):Math.exp(o[2]));
 const fitted=obs.map(o=>adjusted?100*Math.expm1(effect(o[1])):Math.exp(base(o[0])+effect(o[1])));
 const title=adjusted?'Yield departure from neutral trend (%)':'Yield (t/ha)';
 $('historyNote').textContent=r.unit_name+' · '+modelNames[j]+'. '+(adjusted?'Each observation is divided by the selected model’s neutral-ENSO yield at that year, then expressed as a percentage departure.':'Raw yields are shown in t/ha. Scatter predictions are evaluated at the observed mean reporting year; time-series predictions use each observation’s own year.');
 const meanYear=obs.reduce((s,o)=>s+o[0],0)/obs.length;
 const sc=scenario(),xmin=Math.min(r.x_min,sc.x??r.x_min),xmax=Math.max(r.x_max,sc.x??r.x_max);
 const prediction=x=>adjusted?100*Math.expm1(effect(x)):Math.exp(base(meanYear)+effect(x));
 const xx=Array.from({length:151},(_,i)=>xmin+(xmax-xmin)*i/150);
 const yvalues=values.concat(xx.map(prediction));
 let f=plotFrame($('scatter'),xmin,xmax,Math.min(...yvalues),Math.max(...yvalues),'Crop-season Niño 3.4 (°C)',title);
 for(const [a,b,dashed] of [[xmin,r.x_min,true],[r.x_min,r.x_max,false],[r.x_max,xmax,true]]){
   if(b<=a)continue;const curve=Array.from({length:81},(_,i)=>a+(b-a)*i/80).map(x=>[x,prediction(x)]);line($('scatter'),curve,f.X,f.Y,modelColors[j],dashed);
 }
 obs.forEach((o,i)=>dot($('scatter'),f.X(o[1]),f.Y(values[i]),o[0]+': '+fmt(Math.exp(o[2]),3)+' t/ha; ENSO '+fmt(o[1],3)+'°C; plotted '+fmt(values[i],2)));
 if(sc.x!==null){$('scatter').append(svgEl('line',{x1:f.X(sc.x),x2:f.X(sc.x),y1:30,y2:265,stroke:'#899a95','stroke-dasharray':'3 4'}));const marker=svgEl('path',{d:`M ${f.X(sc.x)} ${f.Y(prediction(sc.x))-6} l 6 6 l -6 6 l -6 -6 Z`,fill:modelColors[j],class:'scenario-marker'});const tip=svgEl('title');tip.textContent='Scenario: '+fmt(sc.x,2)+'°C; yield response '+fmt(response(r,sc.x,j))+'%';marker.append(tip);$('scatter').append(marker)}
 $('scatterLegend').innerHTML=`<span>● Observed years</span><span><i style="background:${modelColors[j]}"></i>${modelNames[j]} fit</span><span>◆ Scenario</span><span>Dashed: extrapolation</span>`;
 f=plotFrame($('timeYield'),r.first_year,r.last_year,Math.min(...values,...fitted),Math.max(...values,...fitted),'Reporting year',title,240);
 obs.forEach((o,i)=>{dot($('timeYield'),f.X(o[0]),f.Y(values[i]),o[0]+': observed '+fmt(values[i],2)+'; fitted '+fmt(fitted[i],2));dot($('timeYield'),f.X(o[0]),f.Y(fitted[i]),o[0]+': fitted '+fmt(fitted[i],2),modelColors[j],2);if(i&&o[0]===obs[i-1][0]+1)line($('timeYield'),[[obs[i-1][0],fitted[i-1]],[o[0],fitted[i]]],f.X,f.Y,modelColors[j])});
 f=plotFrame($('timeEnso'),r.first_year,r.last_year,Math.min(0,r.x_min),Math.max(0,r.x_max),'Reporting year','Niño 3.4 (°C)',165);
 obs.forEach(o=>{const col=o[1]>0?'#b2182b':'#2166ac';$('timeEnso').append(svgEl('line',{x1:f.X(o[0]),x2:f.X(o[0]),y1:f.Y(0),y2:f.Y(o[1]),stroke:col,'stroke-width':3}));dot($('timeEnso'),f.X(o[0]),f.Y(o[1]),o[0]+': '+fmt(o[1],3)+'°C',col,2)});
}
function drawScenarioPath(s){
 const svg=$('scenarioPath');$('pathDetails').hidden=s.direct;svg.replaceChildren();svg.style.display=s.direct?'none':'block';if(s.direct||!s.months.length)return;
 const X=m=>65+(m+12)/59*925,Y=v=>150-(v+2)/(Math.max(3,s.amplitude)+2)*110;
 const start=s.months[0].relative,end=s.months.at(-1).relative;
 svg.append(svgEl('rect',{x:X(start)-5,y:26,width:Math.max(2,X(end)-X(start)+10),height:135,fill:'#e0ebe6'}));
 const pts=Object.entries(D.eventProfile.values).map(([date,v])=>[(Number(date.slice(0,4))-1997)*12+Number(date.slice(5))-1,v*s.amplitude/D.eventProfile.peak]);
 line(svg,pts,X,Y,'#a63b32');
 for(let m=-12;m<=47;m+=6)label(svg,['Jan','Jul'][((m%12)+12)%12/6]+' '+(s.year+Math.floor(m/12)),X(m),182,{'text-anchor':'middle'});
 for(const v of [-2,0,s.amplitude]){label(svg,fmt(v)+'°C',55,Y(v)+4,{'text-anchor':'end'});svg.append(svgEl('line',{x1:65,x2:990,y1:Y(v),y2:Y(v),stroke:'#b8c8c1','stroke-dasharray':'2 4'}))}
 label(svg,'Assumed monthly ENSO path; shaded months enter the selected crop exposure',65,15);
}
const originalRender=render,originalSelect=select;
select=function(r){originalSelect(r);const s=scenario();$('unit-summary').innerHTML=`<span class="badge">${r.n} years: ${r.first_year}–${r.last_year}</span><span class="badge">Scenario exposure ${fmt(s.x,2)}°C</span><span class="badge">Linear ${fmt(response(r,s.x,0))}%</span><span class="badge">Quadratic ${fmt(response(r,s.x,1))}%</span><span class="badge">Warm/cold ${fmt(response(r,s.x,2))}%</span>${s.x!==null&&(s.x<r.x_min||s.x>r.x_max)?'<p>Scenario exceeds the observed ENSO range; the dashed fit is an extrapolation.</p>':''}`;drawHistory()};
render=function(){
 current=D.panels.find(p=>p.country===$('country').value&&p.crop===$('crop').value&&p.season===$('season').value);
 const s=scenario();const limit=Number($('colorRange').value);$('colorRange').disabled=$('mapView').value!=='scenario';for(const r of groups.get(current.panel)||[])for(let j=0;j<3;j++)r['scenario_'+j]=response(r,s.x,j);
 fields.splice(0,fields.length,...($('mapView').value==='scenario'?[0,1,2].map(j=>['scenario_'+j,modelNames[j]+' scenario yield change (%)',-limit,limit,1]):originalFields));
 originalRender();
 const cr=(D.coverage||[]).filter(r=>r.crop===current.crop);const fitted=cr.reduce((n,r)=>n+r.fitted,0),source=cr.reduce((n,r)=>n+r.source,0);
 $('coverageNote').textContent=current.crop+': '+fitted+' fitted unit–season series from '+source+' source series across '+new Set(cr.map(r=>r.country)).size+' countries. Selectors show only panels with an eligible fit. Eligibility requires 20 complete positive-yield years and five exposures on each side of neutral ENSO. Component series can overlap.';
 $('coverageRows').innerHTML=cr.map(r=>`<tr><td>${escape(r.country)}</td><td>${escape(r.season)}</td><td>${r.source}</td><td>${r.fitted}</td><td>${r.short}</td><td>${r.sign+r.rank}</td><td>${r.minYears}–${r.maxYears}</td></tr>`).join('');

 $('peakYear').disabled=s.direct;$('cropYearOffset').disabled=s.direct;
 $('scenarioNote').textContent=s.x===null?'No scenario estimate: check inputs or select a reporting year covered by the event profile.':(s.direct?'Direct crop-season average of '+fmt(s.x,2)+'°C. This is not an event-peak conversion.':'Assumed peak '+fmt(s.amplitude,1)+'°C in '+['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][D.eventProfile.peakMonth-1]+' '+s.year+'; crop reporting year '+(s.year+s.offset)+'. Averaging the selected crop window gives '+fmt(s.x,2)+'°C.')+' All responses are relative to neutral ENSO at the same time trend.';
 drawScenarioPath(s);
 const head=$('rows').closest('table').querySelector('thead tr');head.querySelectorAll('.scenarioColumn').forEach(e=>e.remove());for(const t of ['Scenario linear %','Scenario quadratic %','Scenario warm/cold %','Extrapolation']){const th=document.createElement('th');th.className='scenarioColumn';th.textContent=t;head.append(th)}
 const rr=groups.get(current.panel)||[];for(const tr of $('rows').children){const r=rr.find(r=>r.stable_id===tr.dataset.id);for(const value of [...[0,1,2].map(j=>fmt(response(r,s.x,j))),s.x===null?'n/a':s.x<r.x_min||s.x>r.x_max?'Yes':'No']){const td=document.createElement('td');td.textContent=value;tr.append(td)}}
 if(!rr.length){selected=null;drawHistory()}
 // Clear the observation panels when a gray map unit is selected.
 document.querySelectorAll('.unit').forEach(e=>e.addEventListener('click',()=>{if(!rr.some(r=>r.stable_id===e.dataset.id)){selected=null;drawHistory()}}));
};
for(const id of ['scenarioMode','amplitude','peakYear','cropYearOffset','mapView','colorRange'])$(id).onchange=()=>{const id=selected?.stable_id;render();const r=(groups.get(current.panel)||[]).find(r=>r.stable_id===id);if(r)select(r)};
$('dataModel').onchange=drawHistory;$('dataView').onchange=drawHistory;$('season').onchange=render;
$('downloadScenario').onclick=()=>{const s=scenario(),quote=v=>'"'+String(v??'').replaceAll('"','""')+'"';const lines=[['Country','Crop','Season','Unit','Mode','Peak_or_average_C','Peak_year','Reporting_year','Exposure_C','Linear_pct','Quadratic_pct','Warm_cold_pct','Observed_min_C','Observed_max_C','Extrapolation']];for(const r of groups.get(current.panel)||[])lines.push([current.country_name,current.crop,current.season,r.unit_name,s.direct?'season_average':'scaled_1997_98_profile',s.amplitude,s.direct?'':s.year,s.direct?'':s.year+s.offset,s.x,...[0,1,2].map(j=>response(r,s.x,j)),r.x_min,r.x_max,s.x===null?'':s.x<r.x_min||s.x>r.x_max]);download(lines.map(v=>v.map(quote).join(',')).join('\n'),current.panel+'_scenario.csv','text/csv')};
// Include scenario context in the exported SVG.
const originalExport=$('export').onclick;
$('export').onclick=()=>{const title=$('title').textContent;$('title').textContent=title+' · exposure '+fmt(scenario().x,2)+'°C';originalExport();$('title').textContent=title};
render();
