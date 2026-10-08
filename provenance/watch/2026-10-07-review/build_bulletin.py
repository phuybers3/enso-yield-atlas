"""Create a two-page crop bulletin and one-page methods appendix from frozen inputs."""
from pathlib import Path
import json
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, PageBreak
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from pypdf import PdfReader

HERE = Path(__file__).resolve().parent
D = json.loads((HERE/'bulletin_inputs.json').read_text())
ATLAS = HERE.parents[4] / '4_ag/enso-yield-atlas'
REVIEW = json.loads((ATLAS/'watch/context/2026-10-07.json').read_text())
assert REVIEW['issue'] == D['summary']['issue']
for f,h in REVIEW['source_sha256'].items():
    assert D['source_sha256'][f] == h, f
FONT = Path('/Users/phuybers/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/libreoffice-headless/libreoffice/LibreOfficeDev.app/Contents/Resources/fonts/truetype')
for name,fn in [('Body','DejaVuSerif.ttf'),('BodyBold','DejaVuSerif-Bold.ttf'),('BodyItalic','DejaVuSerif-Italic.ttf'),('Sans','DejaVuSans.ttf'),('SansBold','DejaVuSans-Bold.ttf')]:
    pdfmetrics.registerFont(TTFont(name,str(FONT/fn)))
pdfmetrics.registerFontFamily('Body',normal='Body',bold='BodyBold',italic='BodyItalic',boldItalic='BodyBold')
pdfmetrics.registerFontFamily('Sans',normal='Sans',bold='SansBold',italic='Sans',boldItalic='SansBold')
INK=colors.HexColor('#193B45'); MUTED=colors.HexColor('#52636A'); PALE=colors.HexColor('#EEF3F2'); LINE=colors.HexColor('#CAD7D8')
S={
 'body':ParagraphStyle('body',fontName='Body',fontSize=9.7,leading=13.3,textColor=INK,spaceAfter=8),
 'title':ParagraphStyle('title',fontName='SansBold',fontSize=23,leading=27,textColor=INK,spaceAfter=7),
 'deck':ParagraphStyle('deck',fontName='Sans',fontSize=9,leading=12,textColor=MUTED,spaceAfter=11),
 'h':ParagraphStyle('h',fontName='SansBold',fontSize=11.5,leading=15,textColor=INK,spaceBefore=7,spaceAfter=6),
 'caption':ParagraphStyle('caption',fontName='Sans',fontSize=8.1,leading=10.7,textColor=MUTED,spaceAfter=6),
 'cell':ParagraphStyle('cell',fontName='Sans',fontSize=8.7,leading=11,textColor=INK),
 'th':ParagraphStyle('th',fontName='SansBold',fontSize=8.2,leading=10.5,textColor=colors.white),
 'app':ParagraphStyle('app',fontName='Body',fontSize=9.0,leading=11.5,textColor=INK,spaceAfter=7),
 'ref':ParagraphStyle('ref',fontName='Sans',fontSize=8.1,leading=11,textColor=MUTED,spaceAfter=5),
}
OUT=HERE/'output/pdf/enso_crop_bulletin_2026-10-07.pdf'
W=504
story=[]
prose=[]
def p(txt,style='body'):
    story.append(Paragraph(txt,S[style])); prose.append(txt)
def table(rows,widths,header=True):
    grid=[[Paragraph(str(x), S['th' if header and i==0 else 'cell']) for x in row] for i,row in enumerate(rows)]
    t=Table(grid,colWidths=widths,hAlign='LEFT')
    commands=[('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),7),('RIGHTPADDING',(0,0),(-1,-1),7),('TOPPADDING',(0,0),(-1,-1),4),('BOTTOMPADDING',(0,0),(-1,-1),4),('LINEBELOW',(0,-1),(-1,-1),.6,LINE)]
    if header: commands += [('BACKGROUND',(0,0),(-1,0),INK)]
    for i in range(1,len(rows)):
        if i%2: commands.append(('BACKGROUND',(0,i),(-1,i),PALE))
    t.setStyle(TableStyle(commands)); story.append(t);story.append(Spacer(1,5));prose.append(rows)
def pagebreak(): story.append(PageBreak());prose.append('PAGE BREAK')
def pc(v): return f'{v:+.1f}%'

p('El Niño and the 2026-27 harvests','title')
p('7 October 2026  |  Revised research bulletin for review<br/>ENSO observations through September; crop weather through 30 September','deck')
p('El Niño has strengthened rapidly during 2026. We estimate losses in several crops in India, Australia and southern Africa under the current ENSO scenarios. We also estimate gains elsewhere. Weather already observed changes the picture: U.S. maize and soybean conditions point toward losses despite positive ENSO-based expectations.')
p('How 2026 compares with previous events','h')
story.append(Image(str(HERE/'enso_comparison.png'),width=W,height=W*2.45/7))
p('<b>Figure 1.</b> Monthly relative Niño 3.4 from our ERSSTv5 reconstruction. Solid lines are observed. The dashed line and shaded band show the medium and low-to-high 2026-27 scenarios used below; future months follow a scaled 2015-16 shape. [1, 2]','caption')
p('September reached <b>+1.97°C</b>, compared with +1.90°C in September 1997, +1.65°C in 2015 and +1.59°C in 1982 on the same index. The event is already comparable to earlier major El Niños at this point in the year. Its eventual peak and regional weather effects remain uncertain.')
p('Conditional yield losses and gains','h')
rows=[['Country and crop','Harvest','Lower ENSO','Central','Higher ENSO']]
for key in REVIEW['bulletin_selection']:
    r = next(r for r in REVIEW['rows'] if r['iso3']+'|'+r['crop']==key)
    harvest='/'.join(str(y) for y in r['years'])
    label=f"{r['country']} {r['crop']}".replace('United States','U.S.')
    if r['calendar_issues']: label += '†'
    if r['beyond_share'] >= .5 or r['national_only']: label += '*'
    rows.append([label,harvest,*[pc(r['values'][k]) for k in ['low','medium','high']]])

table(rows,[170,79,85,85,85])
p('<b>Table 1.</b> Production-weighted yield changes relative to the fitted trend/neutral-ENSO baseline. Negative values indicate losses. Lower, central and higher refer to ENSO strength assumptions, not percentiles of realized yield losses. *India wheat requires extrapolation; South African maize uses a national fit. †Tracker calendar requires review; weather displays are withheld. See the appendix.','caption')
pagebreak()

p('Weather so far and implications','title')
p('Two-page bulletin, continued  |  Estimates are conditional and provisional','deck')
p('The scenarios use NOAA CPC\'s September outlook for December-February: RONI values of <b>1.48, 2.27 and 3.06°C</b> at the 5th, 50th and 95th percentiles. We combine those strengths with a historical monthly shape and local calendars. Next official outlook: 8 October. [2]')
p('Observed weather can depart from the ENSO expectation','h')
rows=[['Crop and season','ENSO medium','Weather so far','Historical skill']]
labels=['U.S. maize, 2026/27','U.S. soybean, 2026/27','India kharif rice, 2026','Australia wheat, 2026']
for label,r in zip(labels,D['weather_rows']):
    rows.append([label,pc(r['implied']['index_medium_pct']),f"{pc(r['implied']['nowcast_pct'])} ± {r['implied']['nowcast_se_pct']:.1f}",f"{100*r['hindcast']['skill_vs_trend']:.0f}%"])
table(rows,[192,91,121,100])
p('<b>Table 2.</b> Weather estimates use observations through 30 September and differ from the ENSO-only scenarios in Table 1. ± denotes one standard error of the fitted estimate, in percentage points. Realized yield uncertainty is larger. Skill is the reduction in held-out mean squared prediction error relative to a trend-only baseline. [3]','caption')
p('For U.S. maize, observed weather implies <b>-6.1%</b> against <b>+5.0%</b> from the ENSO scenario. Weather estimates reflect rainfall and heat from all causes. We cannot attribute the difference solely to El Niño. India\'s kharif rice model has only a 3% historical skill improvement. Australia\'s wheat estimate requires extrapolation because two weather measures exceed the historical range.')
p('Comparison with FEWS NET','h')
rows=[['Country / crop','Historical production','Our central yield']]
for x in REVIEW['fews']['comparison']:
    r=next(r for r in REVIEW['rows'] if r['iso3']==x['iso3'] and r['crop']==x['crop'])
    rows.append([r['country']+' '+r['crop'],pc(x['historical_production_pct']),pc(r['values']['medium'])])
table(rows,[210,147,147])
p('<b>Table 3.</b> FEWS NET Table 1 reports historical production departures from trend; our column gives current conditional yield changes. Different crop years, trend methods and harvested-area assumptions limit direct comparison. Agreement is a plausibility check. [6]','caption')
p('Implications and timing','h')
p('We would prioritize checking Australian wheat, Indian rice and Southern African maize against local observations and official crop estimates. Trade, stocks and purchasing power determine how yield changes affect food access. Regional gains may offer alternatives, subject to harvest timing and transport.')
p('FEWS NET anticipates Southern Africa’s greatest food-security concern during the November 2027-March 2028 lean season, following the 2027 harvest. We link this dated assessment separately from our crop estimates. [6]')
p('Lower, central and higher ENSO scenarios hold crop responses fixed. They omit unexplained yield variation, coefficient uncertainty and changes in area or management. Calendar checks and independent scientific review remain necessary before operational use.','caption')
p('<link href="https://phuybers3.github.io/enso-yield-atlas/watch/?issue=2026-10-06" color="#193B45">Interactive Crop Watch and downloadable data</link> | Issue 2026-10-06 | Scientific review release','caption')
pagebreak()

p('Appendix | Data and methods','title')
p('Reproducibility notes for the 7 October 2026 bulletin','deck')
p('<b>Yield records and boundaries.</b> We draw from the combined ENSO agricultural database. We prioritize HarvestStat v0.1/v0.2 over the Hultgren replication data, then use national FAOSTAT records where subnational sources are unavailable. India uses HarvestStat\'s merged districts to maintain more stable boundaries. We select the preferred source within each country and crop and exclude series without a fitted response from reported denominators. The Watch contains 643 crop-season panels in 175 countries, with varying coverage. [3]','app')
p('<b>Calendars and harvest years.</b> We link each yield series to the selected planting and harvest calendar, prioritizing the detailed Hultgren calendars, followed by other documented calendars including FAO/GIEWS and rice-calendar sources where applicable. We use recorded days where available and whole months otherwise. The horizon comprises harvests from September 2026 through August 2027. A season planted in 2026 and harvested in 2027 retains harvest year 2027. Some national panels span different local harvest years; the maps now identify each unit’s dates. Typical calendars also require checks against current planting delays.','app')
p('<b>ENSO observations and scenarios.</b> We subtract the tropical-mean sea-surface-temperature anomaly from Niño 3.4, using ERSSTv5 and a 1991-2020 baseline. Figure 1 uses this unscaled relative index throughout. RONI has a further variance rescaling. For this analysis we divide CPC\'s December-February quantiles by 1.178, giving relative-index means of about 1.26, 1.93 and 2.60°C. We retain observed months through September and scale the subsequent 2015-16 monthly path to each winter mean. These are illustrative paths anchored to CPC quantiles; the band is not a calibrated probability envelope for the full trajectory. [1, 2]','app')
p('<b>Crop responses and aggregation.</b> We estimate associations between log yield and the relative ENSO index averaged over the crop season, allowing reporting-unit intercepts and linear trends. We use partially pooled state responses, with country-panel or national fits where required. A slope b and exposure x imply a yield change of 100 × [exp(bx) - 1] percent. We calculate aggregate percentages before rounding tonnes, using fixed weights: HarvestStat\'s 2018-22 production shares or Hultgren crop-area shares, scaled to FAOSTAT\'s 2019-23 national production. Percentages describe covered production and exclude projected changes in harvested area.','app')
p('<b>Weather and validation.</b> We compare the elapsed growing-season weather with the same calendar days in historical seasons from 1981-2025. Temperature uses Berkeley Earth through October 2024 and CPC daily temperatures adjusted to that record thereafter. Rainfall uses the historical archive and CHIRPS for 2026; September CHIRPS is preliminary. Although CPC extends to 5 October, rainfall sets the common cutoff at 30 September. We regress detrended yields on six measures of rainfall and heat. We show weather-based estimates only after half the window has elapsed, with adequate production coverage, a standard error below 40 percentage points and positive leave-one-year-out skill against a trend-only baseline. Detrending and regression are refitted within each validation fold. [3-5]','app')
p('<b>Uncertainty and release corrections.</b> Historical associations can change with irrigation, varieties, management and climate. The scenario table holds fitted slopes fixed. Weather-estimate standard errors use the full coefficient covariance and the exponential transformation; they exclude residual yield variation and other sources of forecast error. Thirty-eight panels pass the current weather-estimate gate. The numerical release corrects 2027 harvest alignment, coefficient uncertainty and overlapping source denominators. The October 7 interface adds season selection and flags tracker windows whose end year differs from the assigned harvest. Affected weather displays are withheld. The archived numerical files retain their original values.','app')
p('Sources and audit trail','h')
p('[1] NOAA PSL, <link href="https://psl.noaa.gov/data/gridded/data.noaa.ersst.v5.html" color="#193B45">ERSSTv5 monthly SST</link>; local relative-index reconstruction through September 2026.<br/>[2] NOAA CPC, <link href="https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso/roni/outlook/" color="#193B45">September 2026 RONI outlook</link> and <link href="https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso_advisory/ensodisc.html" color="#193B45">10 September ENSO discussion</link>, checked 7 October.<br/>[3] <link href="https://phuybers3.github.io/enso-yield-atlas/watch/?issue=2026-10-06#/downloads" color="#193B45">Crop Watch release data</link> and <link href="https://github.com/phuybers3/enso-yield-atlas/tree/main/provenance/watch/2026-10-06" color="#193B45">source hashes, tracker code and validation records</link>.<br/>[4] NOAA PSL, <link href="https://psl.noaa.gov/data/gridded/data.cpc.globaltemp.html" color="#193B45">CPC global daily temperature</link>.<br/>[5] Climate Hazards Center, <link href="https://data.chc.ucsb.edu/products/CHIRPS-2.0/prelim/global_daily/netcdf/p25/" color="#193B45">CHIRPS preliminary daily rainfall, September 2026</link>.<br/>[6] FEWS NET, <link href="https://fews.net/global/special-report/october-2026" color="#193B45">2026-2027 El Niño food security impacts</link>, 6 October 2026, Table 1 and regional assessments. ','ref')

def footer(canvas,doc):
    canvas.saveState();canvas.setStrokeColor(LINE);canvas.line(54,43,558,43)
    canvas.setFont('Sans',8);canvas.setFillColor(MUTED)
    label='Bulletin' if doc.page<=2 else 'Methods appendix'
    canvas.drawString(54,30,f'ENSO Crop Watch  |  7 October 2026  |  For scientific review')
    canvas.drawRightString(558,30,f'{label}  ·  {doc.page}')
    canvas.restoreState()
doc=SimpleDocTemplate(str(OUT),pagesize=(612,792),rightMargin=54,leftMargin=54,topMargin=43,bottomMargin=55,title='El Niño and the 2026-27 harvests | 7 October 2026',author='ENSO Crop Watch',subject='Two-page research bulletin with data and methods appendix')
doc.build(story,onFirstPage=footer,onLaterPages=footer)
reader=PdfReader(OUT)
assert len(reader.pages)==3, f'Expected 2 bulletin pages plus 1 appendix, got {len(reader.pages)}'
assert 'Weather so far and implications' in reader.pages[1].extract_text()
assert 'Appendix | Data and methods' in reader.pages[2].extract_text()
(HERE/'bulletin_content.json').write_text(json.dumps(prose,indent=2,ensure_ascii=False)+'\n')
print(f'Created {OUT} ({len(reader.pages)} pages)')
