"""Extract every div.sectline (and div.seqname) from saved OEIS pages as lists of pieces.

A piece is one of:
	{"kind": "text", "text": ...}
	{"kind": "anumber", "text": "A000984", "href": "/A000984", "title": ...}
	{"kind": "opaque", "text": ...}            (any other element, e.g. a signature link)

The userscript builds exactly the same piece lists from the live DOM, so the test harness
exercises the converter on the same input shape the browser sees.

Usage: python -I extractCorpus.py <directoryOfHtml> <corpus.json>
"""
import html.parser
import json
import pathlib
import re
import sys

regexAnumberHref = re.compile(r'^/A\d{6}$')

class SectionLineCollector(html.parser.HTMLParser):
	def __init__(self):
		super().__init__(convert_charrefs=True)
		self.stackDiv = []
		self.sectionName = None
		self.inSectname = False
		self.pieces = None
		self.depthElementInLine = 0
		self.pieceElement = None
		self.lines = []

	def handle_starttag(self, tag, attrs):
		dictionaryAttributes = dict(attrs)
		if self.pieces is not None and tag != 'div':
			if self.depthElementInLine == 0:
				href = dictionaryAttributes.get('href') or ''
				if tag == 'a' and regexAnumberHref.match(href):
					self.pieceElement = {'kind': 'anumber', 'text': '', 'href': href, 'title': dictionaryAttributes.get('title') or ''}
				else:
					self.pieceElement = {'kind': 'opaque', 'text': ''}
			if tag not in ('br',):
				self.depthElementInLine += 1
			else:
				self.pieces.append({'kind': 'opaque', 'text': '\n'})
				self.pieceElement = None
			return
		if tag != 'div':
			return
		klass = dictionaryAttributes.get('class')
		self.stackDiv.append(klass)
		if klass == 'sectname':
			self.inSectname = True
			self.sectionName = ''
		if klass in ('sectline', 'seqname'):
			self.pieces = []
			if klass == 'seqname':
				self.sectionName = 'NAME'

	def handle_endtag(self, tag):
		if self.pieces is not None and tag != 'div':
			self.depthElementInLine -= 1
			if self.depthElementInLine == 0 and self.pieceElement is not None:
				self.pieces.append(self.pieceElement)
				self.pieceElement = None
			return
		if tag != 'div' or not self.stackDiv:
			return
		klass = self.stackDiv.pop()
		if klass == 'sectname':
			self.inSectname = False
			self.sectionName = self.sectionName.strip()
		if klass in ('sectline', 'seqname') and self.pieces is not None:
			self.lines.append({'section': self.sectionName, 'pieces': self.pieces})
			self.pieces = None

	def handle_data(self, data):
		if self.inSectname:
			self.sectionName += data
		elif self.pieces is not None:
			if self.pieceElement is not None:
				self.pieceElement['text'] += data
			elif self.pieces and self.pieces[-1]['kind'] == 'text':
				self.pieces[-1]['text'] += data
			else:
				self.pieces.append({'kind': 'text', 'text': data})

corpus = {}
for pathFile in sorted(pathlib.Path(sys.argv[1]).glob('A*.html')):
	collector = SectionLineCollector()
	collector.feed(pathFile.read_text(encoding='utf-8'))
	corpus[pathFile.stem] = collector.lines
pathlib.Path(sys.argv[2]).write_text(json.dumps(corpus, ensure_ascii=False, indent='\t'), encoding='utf-8')
