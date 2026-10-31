/* Monthly observations have their own time axis and never reuse seasonal slopes. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.AtlasRecent=factory();
})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  const esc=x=>String(x??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const day=s=>Date.parse(s+'T00:00:00Z')/86400000;
  const iso=d=>new Date(d*86400000).toISOString().slice(0,10);
  const date=s=>new Date(s+'T00:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',timeZone:'UTC'});
  const finite=x=>typeof x==='number'&&Number.isFinite(x);
  const fmt=(x,d=2)=>finite(x)?(x>0?'+':'')+x.toFixed(d).replace('-','−'):'Unavailable';
  const next=m=>{const d=new Date(m+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+1);return d.toISOString().slice(0,10);};
  function prepare({payload,key,enso=[],index='rel',calendar,issue,today}){
    const data=payload?.records?.[key]||{},products=payload?.products||{};
    const months=payload?.months?.length?payload.months:[];
    const cut=Object.values(products).map(x=>x.cutoff).sort().at(-1)||today;
    const start=months[0]?day(months[0]+'-01'):day(cut)-365;
    const finish=Math.max(day(cut)+183,calendar?.harvest_date?day(calendar.harvest_date)+20:0);
    const common={x0:start,x1:finish,plant:calendar?.plant_date?day(calendar.plant_date):null,harvest:calendar?.harvest_date?day(calendar.harvest_date):null,today:day(today)};
    const paths=enso.filter(r=>(r.index||'rel')===index&&finite(r.value)).map(r=>({...r,x:day(`${r.year}-${String(r.month).padStart(2,'0')}-15`),y:r.value}));
    const specs=[{label:'ENSO',chart:{...common,kind:'enso',label:`${index==='std'?'':'Relative '}Niño 3.4 (°C)`,points:paths,issue}}];
    for(const [product,label,color] of [['temperature','Temperature anomaly (°C)','#b7484e'],['rainfall','Rainfall anomaly (mm)','#267f8b'],['ndvi','NDVI anomaly','#46753d']]){
      const meta=products[product],points=(data[product]||[]).map(r=>({month:r[0],through:r[1],value:r[2],reference:r[3],y:r[4],coverage:r[5],n:r[6],x:day(r[0]+'-01')}));
      const available=points.filter(r=>finite(r.y));
      const last=available.at(-1);
      const note=payload?.load_failed?'Monthly observations could not be loaded. Reload to retry.':!payload?'Monthly observations are not included in this release.':!data[product]?'Monthly extraction unavailable for this reporting unit.':!available.length?'Insufficient observations or reference years.':null;
      specs.push({label:product,chart:{...common,kind:product,label,color,points,cutoff:last?.through,declaredCutoff:meta?.cutoff,note}});
    }
    const planting=calendar?.plant_date,harvest=calendar?.harvest_date;
    const phase=planting&&cut<planting?`Before the typical planting date (${date(planting)}).`:
      harvest&&cut>harvest?`After the typical harvest date (${date(harvest)}).`:
      planting&&harvest?'Growing season in progress at the observation cutoff.':'Crop window unavailable at this level.';
    const note=phase+(planting&&harvest?' Shading marks the typical growing season.':'')+
      (specs.slice(1).some(s=>s.chart.points.some(p=>finite(p.y)))?' Open markers indicate partial months.':'');
    const sources=Object.entries(products).map(([k,p])=>`<p><b>${esc(k==='ndvi'?'NDVI':k[0].toUpperCase()+k.slice(1))}</b>: ${esc(p.name)}. Reference starts in ${p.first_reference_year}; at least ten earlier years. ${esc(p.note)}</p>`).join('');
    return {specs,note,sources};
  }
  function chart(o){
    const width=Math.max(280,o.width||480),height=Math.max(112,o.height||132);
    const L=48,R=12,T=27,B=o.xAxis?28:12,W=width-L-R,H=height-T-B;
    const x=v=>L+(v-o.x0)/(o.x1-o.x0)*W;
    const pts=o.points.filter(p=>p.x>=o.x0&&p.x<=o.x1&&finite(p.y));
    const max=Math.max(o.kind==='ndvi'?.01:o.kind==='rainfall'?5:.2,...pts.map(p=>Math.abs(p.y)))*1.12;
    const y=v=>T+H/2-v/max*H/2;
    let svg=`<g data-chart-frame="true"><rect x="${L}" y="${T}" width="${W}" height="${H}" fill="transparent"/>`;
    if(finite(o.plant)&&finite(o.harvest)){
      const a=Math.max(o.x0,o.plant),b=Math.min(o.x1,o.harvest);
      if(b>a)svg+=`<rect data-crop-window="true" x="${x(a)}" y="${T}" width="${x(b)-x(a)}" height="${H}" fill="#edf0e8"><title>Typical crop window: ${iso(o.plant)} to ${iso(o.harvest)}</title></rect>`;
    }
    const digits=o.kind==='ndvi'?2:o.kind==='rainfall'?0:1;
    for(const v of [-max/1.12,0,max/1.12])svg+=`<line x1="${L}" x2="${width-R}" y1="${y(v)}" y2="${y(v)}" stroke="${v===0?'#96968e':'#e5e4df'}"/><text x="${L-7}" y="${y(v)+3}" text-anchor="end">${fmt(v,digits)}</text>`;
    if(o.kind==='enso'){
      const observed=[...new Map(pts.filter(p=>p.observed).map(p=>[p.x,p])).values()].sort((a,b)=>a.x-b.x);
      const draw=(rs,color,dashed)=>{
        let d='',last=null;for(const p of rs){d+=(last!=null&&p.x-last<40?'L':'M')+x(p.x).toFixed(2)+','+y(p.y).toFixed(2);last=p.x;}
        return `<path d="${d}" fill="none" stroke="${color}" stroke-width="2"${dashed?' stroke-dasharray="5 3"':''}/>`;
      };
      for(const [s,c] of [['low','#ac752e'],['high','#8061a4'],['medium','#276d9c']]){
        const f=pts.filter(p=>!p.observed&&p.scenario===s).sort((a,b)=>a.x-b.x);
        svg+=`<g data-scenario="${s}">${draw(observed.length?[observed.at(-1),...f]:f,c,true)}<title>${s} peak scenario</title></g>`;
      }
      svg+=`<g data-observed="true">${draw(observed,'#252525',false)}</g>`;
    }else{
      for(const p of pts){
        const partial=p.through&&day(p.through)+1<day(next(p.month));
        const xx=x((p.x+day(next(p.month)))/2),bw=Math.max(2,Math.min(14,(day(next(p.month))-p.x)/(o.x1-o.x0)*W*.6));
        svg+=`<g tabindex="0" data-month="${p.month}" data-value="${p.y}" data-partial="${!!partial}"><title>${esc(p.month)}${partial?' through '+date(p.through):''}: ${fmt(p.y,o.kind==='ndvi'?3:2)}; observed ${p.value}, reference ${p.reference}; ${p.n} reference years; coverage ${Math.round(p.coverage*100)}%</title><rect x="${xx-bw/2}" y="${Math.min(y(0),y(p.y))}" width="${bw}" height="${Math.max(.8,Math.abs(y(p.y)-y(0)))}" fill="${o.color}" opacity=".8"/>${partial?`<circle cx="${xx}" cy="${y(p.y)}" r="3" stroke="${o.color}" fill="#fbfaf7" stroke-width="1.5"/>`:''}</g>`;
      }
    }
    svg+='</g>';
    if(o.xAxis){
      const tick=new Date(o.x0*86400000);tick.setUTCDate(1);const every=width<420?4:3;
      for(let i=0;day(tick.toISOString().slice(0,10))<=o.x1;i++,tick.setUTCMonth(tick.getUTCMonth()+1))if(i%every===0){const d=tick.toISOString().slice(0,10);svg+=`<text x="${x(day(d))}" y="${height-7}" text-anchor="middle">${esc(tick.toLocaleDateString('en-GB',{month:'short',year:'2-digit',timeZone:'UTC'}))}</text>`;}
    }
    const cutoff=o.kind==='enso'?'Observed / scenarios':o.cutoff?'Through '+date(o.cutoff):'';
    if(o.note){
      const lines=[''];for(const word of o.note.split(' ')){if((lines.at(-1)+' '+word).length>W/6)lines.push(word);else lines[lines.length-1]+=(lines.at(-1)?' ':'')+word;}
      svg+=`<text x="${L+8}" y="${T+H/2-8}">${lines.map((line,i)=>`<tspan x="${L+8}" dy="${i?12:0}">${esc(line)}</tspan>`).join('')}</text>`;
    }
    const label=width<420?o.label.replace(' anomaly','').replace('Relative Niño 3.4','Rel. Niño 3.4'):o.label;
    return `<svg class="recent-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(o.label)}"><title>${esc(o.label)}: monthly observations${o.kind==='enso'?' and seasonal scenarios':''}</title><text x="${L}" y="15" class="recent-label">${esc(label)}</text><text x="${width-R}" y="15" text-anchor="end">${esc(cutoff)}</text>${svg}</svg>`;
  }
  return {prepare,chart};
});
