from pathlib import Path
from xml.sax.saxutils import escape
from bs4 import BeautifulSoup
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.colors import HexColor, white
from reportlab.lib.enums import TA_LEFT
ROOT=Path(__file__).resolve().parents[1]
source=ROOT/'site/bulletin-2026-10-08.html'
out=ROOT/'site/bulletin-2026-10-08.pdf'
soup=BeautifulSoup(source.read_text(),'html.parser')
styles=getSampleStyleSheet()
for key,size,lead in [('Normal',9.5,13),('Heading1',22,25),('Heading2',13,16)]:
 styles[key].fontSize=size;styles[key].leading=lead;styles[key].textColor=HexColor('#203329')
styles['Normal'].spaceAfter=8
styles['Heading2'].spaceBefore=10;styles['Heading2'].spaceAfter=5
styles.add(ParagraphStyle('Note',parent=styles['Normal'],fontSize=8,leading=10,textColor=HexColor('#536058')))
styles.add(ParagraphStyle('Cell',parent=styles['Normal'],fontSize=7.5,leading=10,spaceAfter=0))
def txt(el):
 for a in el.find_all('a'):
  href=a.get('href','')
  if href.startswith('./'): a['href']='https://phuybers3.github.io/enso-yield-atlas/site/'+href[2:]
  elif not href.startswith('http'): a['href']='https://phuybers3.github.io/enso-yield-atlas/site/'+href
 return el.decode_contents().replace('<br/>','<br/>').replace('−','-').replace('–','-').replace('—','-')
story=[]
for si,section in enumerate(soup.select('section')):
 if si:story.append(PageBreak())
 for el in section.children:
  if not getattr(el,'name',None):continue
  if el.name in ('h1','h2','p'):
   style=styles['Heading1' if el.name=='h1' else 'Heading2' if el.name=='h2' else 'Note' if any(c in ['note','kicker'] for c in el.get('class',[])) else 'Normal']
   story.append(Paragraph(txt(el),style))
  elif el.name=='table' or el.find('table'):
   tab=el if el.name=='table' else el.find('table');rows=[[Paragraph(txt(c),styles['Cell']) for c in row.find_all(['th','td'])] for row in tab.find_all('tr')]
   widths=[106,58,53,58,110,119] if len(rows[0])==6 else [120,192,192]
   t=Table(rows,colWidths=widths,repeatRows=1,hAlign='LEFT')
   t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),HexColor('#edf2ea')),('LINEBELOW',(0,0),(-1,-1),.4,HexColor('#cbd3c9')),('VALIGN',(0,0),(-1,-1),'TOP'),('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5)]))
   story+=[t,Spacer(1,7)]
def footer(c,doc):
 c.saveState();c.setFont('Helvetica',8);c.setFillColor(HexColor('#536058'));c.drawString(54,29,'ENSO Crop Watch | 8 October 2026 release | Observations through 30 September');c.drawRightString(558,29,str(doc.page));c.restoreState()
SimpleDocTemplate(str(out),pagesize=(612,792),rightMargin=54,leftMargin=54,topMargin=40,bottomMargin=45,title='ENSO and the 2026-27 harvests',author='ENSO yield atlas').build(story,onFirstPage=footer,onLaterPages=footer)
print(out)
from pypdf import PdfReader
pages=PdfReader(out).pages
print('Pages',len(pages));print([(i+1,len(p.extract_text()),p.extract_text()[:55]) for i,p in enumerate(pages)])
assert len(pages)==3,'Expected two pages plus a one-page appendix'
