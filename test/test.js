/* Regression tests: OEIS notation in, expected LaTeX out, plus span detection on prose.
   Run: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const temml = require('temml');
const o = require('../src/oeisToLatex.js');

const listCase = [
	['a(n) = binomial(2*n, n)/(n+1)', 'a(n) {}= \\frac{\\binom{2n}{n}}{n + 1}'],
	['Sum_{k=0..n-1} a(k)a(n-1-k)', '\\sum_{k=0}^{n - 1} a(k)a(n - 1 - k)'],
	['A(x) = (1 - sqrt(1 - 4*x)) / (2*x)', 'A(x) {}= \\frac{1 - \\sqrt{1 - 4x}}{2x}'],
	['Limit_{n->oo} a(n)/a(n-1) = 4', '\\lim_{n \\to \\infty} \\frac{a(n)}{a(n - 1)} {}= 4'],
	['x == 1 (mod 4)', 'x {}\\equiv 1 \\pmod{4}'],
	['1/(1-x/(1-x/(1-x/(...))))', '\\cfrac{1}{1 - \\cfrac{x}{1 - \\cfrac{x}{1 - \\frac{x}{\\cdots }}}}'],
	['Sum_{d|n} mu(d)*2^(n/d)', '\\sum_{d \\mid n} \\mu(d)\\cdot {2}^{n/d}'],
	['c0 = -1/36 - 2/Pi^2', 'c0 {}= -\\frac{1}{36} {}- \\frac{2}{{\\pi}^{2}}'],
	['Sum_{n>=1} 4^{n-1}*x^n', '\\sum_{n \\ge 1} {4}^{n - 1}\\, {x}^{n}'],
	['(1/(2*Pi))*Integral_{x=0..4} x^n*sqrt((4-x)/x) dx', '\\frac{1}{2\\pi}\\, \\int_{0}^{4} {x}^{n}\\, \\sqrt{\\frac{4 - x}{x}}\\,\\mathrm{d}x'],
	['floor(n/2) + ceiling(n/3)', '\\left\\lfloor \\frac{n}{2}\\right\\rfloor  {}+ \\left\\lceil \\frac{n}{3}\\right\\rceil '],
	['a(n) ~ 4^n / (sqrt(Pi * n) * (n + 1))', 'a(n) {}\\sim \\frac{{4}^{n}}{\\sqrt{\\pi\\, n}(n + 1)}'],
	['n X n', 'n\\times n'],
];

test('OEIS notation to LaTeX', () => {
	listCase.forEach(([source, expected]) => {
		assert.equal(o.latexOfFormula(source), expected, source);
	});
});

test('every expected LaTeX string renders in Temml', () => {
	listCase.forEach(([, expected]) => {
		expected.split(' {}').forEach((chunk) => temml.renderToString(chunk, { throwOnError: true, trust: true }));
	});
});

const sourcesOfMath = (text) => o.convertPieces([{ kind: 'text', text }]).filter((segment) => segment.kind === 'math').map((segment) => segment.source);

test('span detection leaves prose alone', () => {
	assert.deepEqual(sourcesOfMath('It is known that a(n) is odd if and only if n=2^k-1, k=0, 1, 2, 3, ... - Emeric Deutsch, Aug 04 2002'), ['a(n)', 'n=2^k-1, k=0, 1, 2, 3, ...']);
	assert.deepEqual(sourcesOfMath('G.f.: 1/(1-x-x^2/(1-x-x^2/.... (continued fraction). - Paul Barry, Dec 06 2008'), ['1/(1-x-x^2/(1-x-x^2/....']);
	assert.deepEqual(sourcesOfMath('[Bicknell and Hoggatt, pp. 47-48.] - Emeric Deutsch, Oct 15 2006'), []);
	assert.deepEqual(sourcesOfMath('(dan.fux(AT)OpenGaia.com or danfux(AT)OpenGaia.com), Apr 13 2001'), []);
	assert.deepEqual(sourcesOfMath('Thanks to the author!'), []);
	assert.deepEqual(sourcesOfMath('From Joerg Arndt, Jul 11 2011: (Start)'), []);
});

test('layout lines are verbatim', () => {
	assert.equal(o.isLineVerbatim('  01:  [ 1 1 1 1 . ]'), true);
	assert.equal(o.isLineVerbatim('1   2   3'), true);
	assert.equal(o.isLineVerbatim('+---+---+'), true);
	assert.equal(o.isLineVerbatim('a(n) = Sum_{k=0..n} binomial(n,k).'), false);
});
