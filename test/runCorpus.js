/* Run the converter over every NAME / COMMENTS / FORMULA line of the corpus and render each
   chunk with Temml. Writes test/report.html for eyeballing and prints failure statistics. */
const fs = require('fs');
const path = require('path');
const temml = require('temml');
const o = require('../src/oeisToLatex.js');

const setSection = new Set(['NAME', 'COMMENTS', 'FORMULA']);
const corpus = JSON.parse(fs.readFileSync(path.join(__dirname, 'corpus.json'), 'utf8'));
const render = (latexString) => temml.renderToString(`\\displaystyle ${latexString}`, { throwOnError: true, trust: true, strict: false });
const failures = [];
const rows = [];
let countLine = 0;
let countSpan = 0;
const escapeHtml = (text) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
Object.entries(corpus).forEach(([idSequence, lines]) => {
	lines.filter((line) => setSection.has(line.section)).forEach((line) => {
		countLine += 1;
		const segments = o.convertPieces(line.pieces, render, (source, error) => failures.push({ idSequence, section: line.section, source, message: error.message }));
		const html = segments.map((segment) => {
			if (segment.kind === 'math') {
				countSpan += 1;
				return `<span class="m" title="${escapeHtml(segment.source)}">${segment.chunks.map((chunk) => chunk.gap + chunk.rendered).join('​')}</span>`;
			}
			if (segment.kind === 'piece') {
				const piece = line.pieces[segment.idPiece];
				return `<u>${escapeHtml(piece.text)}</u>`;
			}
			return escapeHtml(segment.text);
		}).join('');
		const original = line.pieces.map((piece) => piece.text).join('');
		rows.push(`<tr><td class=id>${idSequence}<br>${line.section}</td><td class=src>${escapeHtml(original)}</td><td class=out>${html}</td></tr>`);
	});
});
fs.writeFileSync(path.join(__dirname, 'report.html'), `<!doctype html><meta charset=utf-8><style>
body{font-family:Cambria,Georgia,serif;margin:16px}table{border-collapse:collapse;width:100%}td{vertical-align:top;padding:6px 8px;border-top:1px solid #ddd}
td.id{font:11px monospace;color:#777;width:70px}td.src{font:12px/1.4 Consolas,monospace;white-space:pre-wrap;width:40%}td.out{font-size:15px;line-height:1.7;white-space:pre-wrap}
span.m{background:#f3f6ff}math{font-family:"Cambria Math","STIX Two Math","Latin Modern Math",math}
</style><table>${rows.join('\n')}</table>`);
console.log({ countLine, countSpan, countFailure: failures.length });
const byMessage = {};
failures.forEach((failure) => { byMessage[failure.message] = (byMessage[failure.message] || 0) + 1; });
console.log(Object.entries(byMessage).sort((a, b) => b[1] - a[1]).slice(0, 25));
fs.writeFileSync(path.join(__dirname, 'failures.json'), JSON.stringify(failures, null, '\t'));
