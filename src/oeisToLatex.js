/*
oeisToLatex — read OEIS plain-text notation, find the math inside mixed prose, emit LaTeX.

The notation is defined by the OEIS Style Sheet (https://oeis.org/wiki/Style_Sheet,
"Spelling and notation"): Sum_{k=a..b}, Product_{k=a..b}, Integral_{x=a..b}, lim_{n->oo},
binomial(n,k) or C(n,k), floor, ceiling, sqrt, ^ for powers, * for products, == for
congruence, (mod m), +-, <=, >=, != or <>, oo, Pi, phi, and so on.

No library parses that notation, so this module is the only hand-written translator in the
project. Everything it emits is ordinary LaTeX for an off-the-shelf engine (Temml).

Design rules
	1. Never make a line worse. Any span that fails to parse is left as the original text.
	2. Prose stays prose. Math spans are found token by token; English words end a span.
	3. Grouping that a 2-D layout makes visible is dropped: x^(n-1) -> x^{n-1},
	   (a+b)/(c+d) -> \frac{a+b}{c+d}.

Input: a list of pieces, the same shape the userscript builds from the DOM:
	{kind: 'text', text}
	{kind: 'anumber', text: 'A000984', href, title}   a link to another sequence
	{kind: 'opaque', text}                             any other element (signature link, <br>, ...)

Output of `convertPieces`: a list of segments
	{kind: 'source', idPiece, text}     a run of original text from one text piece
	{kind: 'piece', idPiece}           an anumber or opaque piece left untouched
	{kind: 'math', source, chunks, listPart}
	                                   rendered math. `chunks` are {latex, gap, rendered} with a
	                                   line-break opportunity between each; `source` is the
	                                   original text (for copying); `listPart` lists the original
	                                   source/piece segments the span replaced (for the toggle).
*/
(function (rootGlobal) {
	'use strict';

	/* ------------------------------------------------------------------ vocabulary */

	const mapGreek = {
		alpha: '\\alpha', beta: '\\beta', gamma: '\\gamma', delta: '\\delta', epsilon: '\\varepsilon',
		zeta: '\\zeta', eta: '\\eta', theta: '\\theta', iota: '\\iota', kappa: '\\kappa', lambda: '\\lambda',
		mu: '\\mu', nu: '\\nu', xi: '\\xi', pi: '\\pi', Pi: '\\pi', rho: '\\rho', sigma: '\\sigma', tau: '\\tau',
		upsilon: '\\upsilon', phi: '\\varphi', chi: '\\chi', psi: '\\psi', omega: '\\omega',
		Gamma: '\\Gamma', Delta: '\\Delta', Theta: '\\Theta', Lambda: '\\Lambda', Xi: '\\Xi', Sigma: '\\Sigma',
		Upsilon: '\\Upsilon', Phi: '\\Phi', Psi: '\\Psi', Omega: '\\Omega', bigomega: '\\Omega',
	};

	const mapConstant = { oo: '\\infty', inf: '\\infty', infinity: '\\infty', Infinity: '\\infty' };

	/* Named functions with a LaTeX operator of their own. Unknown multi-letter function names
	   become \operatorname{name}. */
	const mapFunction = {
		sin: '\\sin', cos: '\\cos', tan: '\\tan', cot: '\\cot', sec: '\\sec', csc: '\\csc',
		sinh: '\\sinh', cosh: '\\cosh', tanh: '\\tanh', coth: '\\coth',
		arcsin: '\\arcsin', arccos: '\\arccos', arctan: '\\arctan',
		exp: '\\exp', log: '\\log', ln: '\\ln', lg: '\\lg', det: '\\det', deg: '\\deg', dim: '\\dim',
		gcd: '\\gcd', GCD: '\\gcd', lcm: '\\operatorname{lcm}', LCM: '\\operatorname{lcm}',
		max: '\\max', min: '\\min', sup: '\\sup', inf: '\\inf', Re: '\\operatorname{Re}', Im: '\\operatorname{Im}',
	};

	/* Functions that change layout rather than just their name. */
	const setLayoutFunction = new Set(['sqrt', 'binomial', 'Binomial', 'floor', 'Floor', 'ceiling', 'ceil', 'abs']);

	/* Big operators: Name_{sub}^{sup} body. */
	const mapBigOperator = {
		Sum: '\\sum', Product: '\\prod', Prod: '\\prod', Integral: '\\int', Int: '\\int',
		lim: '\\lim', Limit: '\\lim', Lim: '\\lim', limsup: '\\limsup', liminf: '\\liminf',
		max: '\\max', min: '\\min', Max: '\\max', Min: '\\min',
	};

	/* Words that are math wherever they appear, even without an operator next to them. */
	const setWordMath = new Set([
		...Object.keys(mapGreek), ...Object.keys(mapConstant), 'mod',
		'dx', 'dy', 'dz', 'dt', 'du', 'dv', 'ds', 'dq',
	]);

	const mapRelation = {
		'=': '=', '==': '\\equiv', '!=': '\\ne', '<>': '\\ne', '<': '<', '>': '>', '<=': '\\le', '>=': '\\ge',
		'~': '\\sim', '->': '\\to', ':=': '\\coloneqq', '\\approx': '\\approx', '|': '\\mid',
	};

	const mapAdditive = { '+': '+', '-': '-', '+-': '\\pm', '-+': '\\mp' };

	/* Operators whose presence makes a candidate span math rather than, say, a date. */
	const setOperatorStrong = new Set([
		'=', '==', '!=', '<>', '<', '>', '<=', '>=', '~', '->', ':=', '\\approx',
		'^', '_', '*', '/', '+', '!', '+-', '-+', '|', '..',
	]);

	const setBackslashCommand = new Set(['\\approx']);

	/* ------------------------------------------------------------------ lexer */

	/* Each rule: [type, regex]. Order matters; every regex is sticky (y). */
	const listRuleLexer = [
		['space', /\s+/y],
		['word', /[A-Za-z0-9._+-]+\(AT\)[A-Za-z0-9.-]+/y],
		['word', /(?:https?|ftp):\/\/[^\s)]+/y],
		['word', /(?:[A-Za-z]{1,2}\.){2,}/y],
		['word', /\d+(?:st|nd|rd|th)(?![A-Za-z])/y],
		['num', /\d+(?:\.(?!\.)\d+)?/y],
		['ident', /[A-Za-z][A-Za-z0-9]*/y],
		['op', /\.\.\.+|\.\.|<=|>=|==|!=|<>|->|:=|\+-|-\+/y],
		['op', /\\[A-Za-z]+/y],
		['open', /[([{]/y],
		['close', /[)\]}]/y],
		['comma', /,/y],
		['semi', /;/y],
		['colon', /:/y],
		['period', /\./y],
		['word', /[^\x00-\x7F]+/y],
		['op', /[\s\S]/y],
	];

	/* After an identifier or number: -word (x-axis, n-th, q-Catalan, 2-adic) and 's (Lucas's). */
	const regexCompound = /-(?:[A-Za-z]{3,}|th|st|nd|rd)(?![A-Za-z0-9(_^])/y;
	const regexPossessive = /'s(?![A-Za-z])/y;

	function lexText(text, idPiece) {
		const listToken = [];
		let index = 0;
		while (index < text.length) {
			const [type, regex] = listRuleLexer.find(([, regexRule]) => {
				regexRule.lastIndex = index;
				return regexRule.test(text);
			});
			regex.lastIndex = index;
			const match = regex.exec(text);
			let raw = match[0];
			let typeToken = type;
			if (type === 'ident' || type === 'num') {
				regexCompound.lastIndex = index + raw.length;
				const matchCompound = regexCompound.exec(text);
				if (matchCompound && !setWordMath.has(matchCompound[0].slice(1)) && !(matchCompound[0].slice(1) in mapFunction) && !setLayoutFunction.has(matchCompound[0].slice(1))) {
					raw += matchCompound[0];
					typeToken = 'word';
				}
				regexPossessive.lastIndex = index + raw.length;
				if (type === 'ident' && raw.length > 1 && regexPossessive.test(text)) {
					raw += "'s";
					typeToken = 'word';
				}
			}
			if (typeToken === 'op' && raw.startsWith('\\') && raw.length > 1 && !setBackslashCommand.has(raw)) {
				typeToken = 'word';
			}
			if (typeToken === 'op' && /^\.{3,}$/.test(raw)) {
				typeToken = 'dots';
			}
			listToken.push({ type: typeToken, value: raw, raw, idPiece });
			index += raw.length;
		}
		return listToken;
	}

	function lexPieces(listPiece) {
		const listToken = listPiece.flatMap((piece, idPiece) => {
			if (piece.kind === 'text') {
				return lexText(piece.text, idPiece);
			}
			return [{ type: piece.kind, value: piece.text, raw: piece.text, idPiece, piece }];
		});
		listToken.forEach((token, index) => {
			token.index = index;
			token.spaceBefore = index > 0 && listToken[index - 1].type === 'space';
		});
		matchBrackets(listToken);
		return listToken;
	}

	const mapCloseForOpen = { '(': ')', '[': ']', '{': '}' };

	function matchBrackets(listToken) {
		const stack = [];
		listToken.forEach((token, index) => {
			if (token.type === 'open') {
				stack.push(index);
			}
			if (token.type === 'close') {
				const indexOpen = stack.length > 0 && stack[stack.length - 1];
				if (stack.length > 0 && mapCloseForOpen[listToken[indexOpen].value] === token.value) {
					stack.pop();
					listToken[indexOpen].indexMatch = index;
					token.indexMatch = indexOpen;
				}
			}
		});
	}

	/* ------------------------------------------------------------------ span detection */

	function isCallable(token) {
		return Boolean(token) && (token.type === 'ident' || token.type === 'anumber' || token.type === 'close' || (token.type === 'op' && (token.value === "'" || token.value === '!')));
	}

	function nextNonSpace(listToken, index) {
		return listToken.slice(index).find((token) => token.type !== 'space');
	}

	/* An identifier is math if it is a single letter, contains a digit, is a known math word,
	   or has an operator glued to it (call, script, factorial, prime). Otherwise it is prose. */
	function classifyIdentifier(listToken, index) {
		const token = listToken[index];
		const value = token.value;
		const tokenNext = listToken[index + 1];
		const listGlue = (value.length === 1 && ['_', '^', '!', "'"]) || ['_', '^', "'"];
		const isGlued = Boolean(tokenNext) && ((tokenNext.type === 'open' && tokenNext.value === '(') || (tokenNext.type === 'op' && listGlue.includes(tokenNext.value)));
		if (value.length === 1 || /\d/.test(value) || setWordMath.has(value) || isGlued) {
			return 'M';
		}
		return 'P';
	}

	function classifyToken(listToken, index) {
		const token = listToken[index];
		const mapClass = {
			ident: () => classifyIdentifier(listToken, index),
			num: () => 'M', op: () => 'M', dots: () => 'M', anumber: () => 'M',
			open: () => 'M', close: () => 'M',
			word: () => 'P', opaque: () => 'P',
			space: () => 'N', comma: () => 'N', semi: () => 'N', colon: () => 'N', period: () => 'N',
		};
		return mapClass[token.type]();
	}

	/* A bracket group is atomic math when it is attached to something callable or to a script
	   operator, when it is "(mod m)", or when nothing at its own level is prose. Otherwise the
	   brackets are prose punctuation and the inside is searched for spans of its own. */
	function isGroupMath(listToken, indexOpen) {
		const indexClose = listToken[indexOpen].indexMatch;
		const tokenBefore = listToken[indexOpen - 1];
		const isAttached = Boolean(tokenBefore) && !listToken[indexOpen].spaceBefore
			&& (isCallable(tokenBefore) || (tokenBefore.type === 'op' && (tokenBefore.value === '_' || tokenBefore.value === '^')));
		if (isAttached) {
			return true;
		}
		const tokenFirst = nextNonSpace(listToken.slice(0, indexClose), indexOpen + 1);
		if (!tokenFirst) {
			return false;
		}
		if (tokenFirst.type === 'ident' && tokenFirst.value === 'mod') {
			return true;
		}
		let index = indexOpen + 1;
		let countProse = 0;
		while (index < indexClose) {
			const token = listToken[index];
			if (token.type === 'open' && token.indexMatch !== undefined) {
				index = token.indexMatch + 1;
				continue;
			}
			if (classifyToken(listToken, index) === 'P') {
				countProse += 1;
			}
			index += 1;
		}
		return countProse === 0;
	}

	/* Find candidate spans [start, end) over token indices. */
	function findSpans(listToken, indexStart, indexEnd) {
		const listSpan = [];
		let spanCurrent = null;
		let indexPending = null;
		const closeSpan = () => {
			if (spanCurrent) {
				listSpan.push(spanCurrent);
			}
			spanCurrent = null;
			indexPending = null;
		};
		const extendSpan = (indexFrom, indexTo) => {
			if (!spanCurrent) {
				spanCurrent = { start: indexFrom, end: indexTo };
			} else {
				spanCurrent.end = indexTo;
			}
			indexPending = null;
		};
		let index = indexStart;
		while (index < indexEnd) {
			const token = listToken[index];
			if (token.type === 'open' && token.indexMatch !== undefined && token.indexMatch < indexEnd) {
				if (isGroupMath(listToken, index)) {
					extendSpan(index, token.indexMatch + 1);
					index = token.indexMatch + 1;
					continue;
				}
				closeSpan();
				listSpan.push(...findSpans(listToken, index + 1, token.indexMatch));
				index = token.indexMatch + 1;
				continue;
			}
			const classToken = classifyToken(listToken, index);
			if (classToken === 'M') {
				extendSpan(index, index + 1);
			} else if (classToken === 'P') {
				closeSpan();
			} else if (token.type === 'space' || (token.type === 'comma' && spanCurrent)) {
				if (indexPending === null) {
					indexPending = index;
				}
			} else {
				closeSpan();
			}
			index += 1;
		}
		closeSpan();
		return listSpan;
	}

	const setOperatorBinaryTrailing = new Set(['-', '+', '*', '/', '=', '^', '_', '+-', '<', '>', '<=', '>=', '==', '~', '|']);

	function trimSpan(listToken, span) {
		let { start, end } = span;
		const isTrimmableEnd = (token) => token.type === 'space' || token.type === 'comma'
			|| (token.type === 'op' && setOperatorBinaryTrailing.has(token.value));
		while (end > start && isTrimmableEnd(listToken[end - 1])) {
			end -= 1;
		}
		const isTrimmableStart = (token) => token.type === 'space' || token.type === 'comma'
			|| (token.type === 'op' && ['=', '*', '/', '^', '_'].includes(token.value));
		while (start < end && isTrimmableStart(listToken[start])) {
			start += 1;
		}
		return { start, end };
	}

	/* A span is worth typesetting if it holds a real operator, a function call, or a math word.
	   Bare numbers, page ranges like 47-48, and lone letters stay as text. */
	function isSpanStrong(listToken, span) {
		const listTokenSpan = listToken.slice(span.start, span.end).filter((token) => token.type !== 'space');
		const isNumbersAndDashes = listTokenSpan.every((token) => token.type === 'num' || token.type === 'comma' || token.type === 'dots' || (token.type === 'op' && token.value === '-'));
		if (isNumbersAndDashes) {
			return false;
		}
		/* Mathematica (f[x], Table[...]) is code, not notation. */
		const isMathematica = listTokenSpan.some((token, index) => token.type === 'ident' && token.value.length > 1 && listTokenSpan[index + 1] && listTokenSpan[index + 1].type === 'open' && listTokenSpan[index + 1].value === '[' && !listTokenSpan[index + 1].spaceBefore);
		if (isMathematica) {
			return false;
		}
		return listTokenSpan.some((token, index) => {
			const tokenNext = listTokenSpan[index + 1];
			const isCall = (token.type === 'ident' || token.type === 'anumber') && Boolean(tokenNext) && tokenNext.type === 'open' && tokenNext.value === '(' && !tokenNext.spaceBefore;
			const isWordMath = token.type === 'ident' && token.value.length > 1 && setWordMath.has(token.value);
			const isBigOperator = token.type === 'ident' && token.value in mapBigOperator && Boolean(tokenNext) && tokenNext.type === 'op' && tokenNext.value === '_';
			const isOperator = token.type === 'op' && (setOperatorStrong.has(token.value) || (token.value === '-' && index > 0));
			return isCall || isWordMath || isBigOperator || isOperator;
		});
	}

	const patternOperand = "[\\w)\\]}'!]";
	const patternOperandStart = '[\\w(\\[{|]';
	const patternOperatorAligned = '(?:<=|>=|==|!=|<>|:=|\\+-|-\\+|[=<>~+\\-*/])';
	const regexOperandThenOperator = new RegExp(`${patternOperand} *${patternOperatorAligned}$`);
	const regexOperatorThenOperand = new RegExp(`^${patternOperatorAligned} +${patternOperandStart}`);
	const regexOperandAhead = new RegExp(`^${patternOperandStart}`);
	const regexOperandBehind = new RegExp(`${patternOperand}$`);
	const regexRelationAligned = /<=|>=|==|!=|<>|:=|[=~]/;

	/* A run of spaces that lines up an equation touches an operator with an operand on its far
	   side: "A076876(n)   = [T(n,3) -     T(n,2)]/2". A run between cells touches two operands
	   ("a(0)   a(1)") or a sign ("-1   -2"). */
	function isRunAlignment(text, indexStart, indexEnd) {
		const before = text.slice(0, indexStart);
		const after = text.slice(indexEnd);
		return (regexOperandThenOperator.test(before) && regexOperandAhead.test(after))
			|| (regexOperandBehind.test(before) && regexOperatorThenOperand.test(after));
	}

	/* Lines whose spacing is layout (ASCII diagrams, aligned tables) are never touched. Spaces
	   that only line up an equation are not layout: the parser ignores them and the source view
	   keeps them. Rows without a relation stay verbatim, so "1   -   2   -   3" is still a diagram. */
	function isLineVerbatim(text) {
		if (/^ {2,}\S/.test(text) || /([-_=|+*\\/#])\1{2,}/.test(text)) {
			return true;
		}
		const listRun = Array.from(text.matchAll(/(?<=\S) {3,}(?=\S)/g));
		if (listRun.length === 0) {
			return false;
		}
		return !regexRelationAligned.test(text) || !listRun.every((run) => isRunAlignment(text, run.index, run.index + run[0].length));
	}

	/* ------------------------------------------------------------------ parser */

	class ErrorParse extends Error {}

	function parseSpan(listTokenSpan) {
		const listToken = listTokenSpan.filter((token) => token.type !== 'space');
		const state = { listToken, index: 0, depthAbs: 0 };
		const node = parseList(state, null);
		if (state.index < listToken.length) {
			throw new ErrorParse(`unexpected ${listToken[state.index].value}`);
		}
		return node;
	}

	function peek(state, offset) {
		return state.listToken[state.index + (offset || 0)];
	}

	function take(state) {
		const token = state.listToken[state.index];
		state.index += 1;
		return token;
	}

	function isOp(token, value) {
		return Boolean(token) && token.type === 'op' && token.value === value;
	}

	function isIdent(token, value) {
		return Boolean(token) && token.type === 'ident' && token.value === value;
	}

	function isSeparator(token, closeExpected) {
		if (!token) {
			return false;
		}
		if (token.type === 'comma') {
			return true;
		}
		return closeExpected !== null && (token.type === 'semi' || token.type === 'colon');
	}

	function parseList(state, closeExpected) {
		const listItem = [parseRelation(state)];
		const listSeparator = [];
		while (isSeparator(peek(state), closeExpected)) {
			listSeparator.push(take(state).type);
			listItem.push(parseRelation(state));
		}
		if (listItem.length === 1) {
			return listItem[0];
		}
		return { kind: 'list', listItem, listSeparator };
	}

	function isRelation(state, token) {
		if (!token || token.type !== 'op' || !(token.value in mapRelation)) {
			return false;
		}
		return token.value !== '|' || state.depthAbs === 0;
	}

	function parseRelation(state) {
		const listOperand = [parseRange(state)];
		const listOperator = [];
		while (isRelation(state, peek(state))) {
			listOperator.push(take(state).value);
			listOperand.push(parseRange(state));
		}
		if (listOperand.length === 1) {
			return listOperand[0];
		}
		return { kind: 'relation', listOperand, listOperator };
	}

	function parseRange(state) {
		const low = parseAdditive(state);
		if (isOp(peek(state), '..')) {
			take(state);
			const tokenHigh = peek(state);
			const high = (startsOperand(state, tokenHigh) || (tokenHigh && tokenHigh.type === 'op' && tokenHigh.value in mapAdditive)) && parseAdditive(state);
			return { kind: 'range', low, high: high || null };
		}
		return low;
	}

	function parseAdditive(state) {
		const listTerm = [parseMultiplicative(state)];
		const listOperator = [];
		while (peek(state) && peek(state).type === 'op' && peek(state).value in mapAdditive) {
			listOperator.push(take(state).value);
			listTerm.push(parseMultiplicative(state));
		}
		if (listTerm.length === 1) {
			return listTerm[0];
		}
		return { kind: 'additive', listTerm, listOperator };
	}

	/* Can `token` begin an operand that is juxtaposed (implicit multiplication)? */
	function startsOperand(state, token) {
		if (!token) {
			return false;
		}
		if (token.type === 'ident') {
			return token.value !== 'mod' && !(token.value === 'X' && token.spaceBefore);
		}
		if (token.type === 'op') {
			return token.value === '#';
		}
		return ['num', 'word', 'anumber', 'open', 'dots'].includes(token.type);
	}

	/* Multiplicative level. Juxtaposition without a space ("2n", "a(k)a(n-k)") binds tighter
	   than * and /; juxtaposition with a space binds like *. */
	function parseMultiplicative(state) {
		const listFactor = [parseUnary(state)];
		const listOperator = [];
		for (;;) {
			const token = peek(state);
			if (isOp(token, '*') || isOp(token, '/')) {
				listOperator.push(take(state).value);
				listFactor.push(parseUnary(state));
			} else if (isIdent(token, 'mod')) {
				take(state);
				listOperator.push('mod');
				listFactor.push(parseUnary(state));
			} else if (isIdent(token, 'X') && token.spaceBefore && peek(state, 1) && peek(state, 1).spaceBefore) {
				take(state);
				listOperator.push('times');
				listFactor.push(parseUnary(state));
			} else if (startsOperand(state, token)) {
				listOperator.push((token.spaceBefore && 'juxtaposeSpace') || 'juxtapose');
				listFactor.push(parsePower(state));
			} else {
				break;
			}
		}
		/* bind tight juxtaposition first */
		const listFactorTight = [listFactor[0]];
		const listOperatorLoose = [];
		listOperator.forEach((operator, index) => {
			const factor = listFactor[index + 1];
			if (operator === 'juxtapose') {
				const last = listFactorTight[listFactorTight.length - 1];
				listFactorTight[listFactorTight.length - 1] = appendProduct(last, 'juxtapose', factor);
			} else {
				listOperatorLoose.push(operator);
				listFactorTight.push(factor);
			}
		});
		return listOperatorLoose.reduce((accumulator, operator, index) => {
			const factor = listFactorTight[index + 1];
			if (operator === '/') {
				return { kind: 'fraction', numerator: accumulator, denominator: factor };
			}
			return appendProduct(accumulator, operator, factor);
		}, listFactorTight[0]);
	}

	function appendProduct(left, operator, right) {
		if (left.kind === 'product' && !left.isClosed) {
			return { kind: 'product', listFactor: [...left.listFactor, right], listOperator: [...left.listOperator, operator] };
		}
		return { kind: 'product', listFactor: [left, right], listOperator: [operator] };
	}

	function parseUnary(state) {
		const token = peek(state);
		if (token && token.type === 'op' && token.value in mapAdditive) {
			take(state);
			return { kind: 'unary', operator: token.value, operand: parseUnary(state) };
		}
		return parsePower(state);
	}

	function parsePower(state) {
		const base = parsePostfix(state);
		if (isOp(peek(state), '^')) {
			take(state);
			return { kind: 'power', base, exponent: parseExponent(state) };
		}
		return base;
	}

	function parseExponent(state) {
		const token = peek(state);
		if (token && token.type === 'open' && token.value === '{') {
			take(state);
			const inner = parseList(state, '}');
			expectClose(state, '}');
			return inner;
		}
		if (token && token.type === 'op' && token.value in mapAdditive) {
			take(state);
			return { kind: 'unary', operator: token.value, operand: parseExponent(state) };
		}
		return parsePower(state);
	}

	function parsePostfix(state) {
		let node = parsePrimary(state);
		for (;;) {
			const token = peek(state);
			if (isOp(token, '!') && !token.spaceBefore) {
				take(state);
				if (node.kind === 'factorial' && !node.isDouble && !node.isClosed) {
					node = { kind: 'factorial', operand: node.operand, isDouble: true };
				} else {
					node = { kind: 'factorial', operand: node, isDouble: false };
				}
			} else if (isOp(token, "'") && !token.spaceBefore) {
				take(state);
				node = { kind: 'prime', operand: node };
			} else if (isOp(token, '_') && !token.spaceBefore) {
				take(state);
				node = { kind: 'subscript', base: node, script: parseScript(state) };
			} else if (token && token.type === 'open' && token.value === '(' && !token.spaceBefore && (node.kind === 'subscript' || node.kind === 'prime')) {
				node = { kind: 'call', name: node, ...parseArguments(state) };
			} else {
				break;
			}
		}
		return node;
	}

	function parseScript(state) {
		const token = peek(state);
		if (!token) {
			throw new ErrorParse('empty script');
		}
		if (token.type === 'open' && token.value === '{') {
			take(state);
			const inner = parseList(state, '}');
			expectClose(state, '}');
			return inner;
		}
		if (token.type === 'open') {
			return parsePrimary(state);
		}
		if (['num', 'ident', 'anumber'].includes(token.type)) {
			take(state);
			return nodeFromAtom(token);
		}
		if (token.type === 'op' && token.value in mapAdditive) {
			take(state);
			return { kind: 'unary', operator: token.value, operand: parseScript(state) };
		}
		throw new ErrorParse(`bad script ${token.value}`);
	}

	function expectClose(state, value) {
		const token = peek(state);
		if (!token) {
			return false;
		}
		if (token.type === 'close' && token.value === value) {
			take(state);
			return true;
		}
		throw new ErrorParse(`expected ${value} got ${token.value}`);
	}

	function parseArguments(state) {
		take(state);
		if (peek(state) && peek(state).type === 'close' && peek(state).value === ')') {
			take(state);
			return { listArgument: [], isClosed: true };
		}
		const inner = parseList(state, ')');
		const isClosed = expectClose(state, ')');
		const listArgument = (inner.kind === 'list' && inner.listSeparator.every((separator) => separator === 'comma') && inner.listItem) || [inner];
		return { listArgument, isClosed };
	}

	function nodeFromAtom(token) {
		if (token.type === 'num') {
			return { kind: 'number', value: token.value };
		}
		if (token.type === 'anumber') {
			return { kind: 'anumber', value: token.value };
		}
		return { kind: 'symbol', value: token.value };
	}

	function parsePrimary(state) {
		const token = take(state);
		if (!token) {
			throw new ErrorParse('unexpected end');
		}
		if (token.type === 'num') {
			return { kind: 'number', value: token.value };
		}
		if (token.type === 'anumber') {
			const node = { kind: 'anumber', value: token.value };
			if (peek(state) && peek(state).type === 'open' && peek(state).value === '(' && !peek(state).spaceBefore) {
				return { kind: 'call', name: node, ...parseArguments(state) };
			}
			return node;
		}
		if (token.type === 'ident') {
			return parseIdentifier(state, token);
		}
		if (token.type === 'word') {
			return { kind: 'text', value: token.value };
		}
		if (token.type === 'dots') {
			return { kind: 'dots' };
		}
		if (token.type === 'open') {
			return parseGroup(state, token.value);
		}
		if (isOp(token, '|')) {
			state.depthAbs += 1;
			const inner = parseList(state, '|');
			state.depthAbs -= 1;
			if (!isOp(peek(state), '|')) {
				throw new ErrorParse('unclosed |');
			}
			take(state);
			return { kind: 'absolute', inner };
		}
		if (isOp(token, '#')) {
			return { kind: 'cardinality', operand: parsePostfix(state) };
		}
		if (isOp(token, '!')) {
			return { kind: 'subfactorial', operand: parsePostfix(state) };
		}
		throw new ErrorParse(`unexpected ${token.value}`);
	}

	function parseGroup(state, open) {
		const close = mapCloseForOpen[open];
		if (peek(state) && peek(state).type === 'close' && peek(state).value === close) {
			take(state);
			return { kind: 'group', open, inner: null, isClosed: true };
		}
		if (open === '(' && isIdent(peek(state), 'mod')) {
			take(state);
			const inner = parseList(state, close);
			const isClosed = expectClose(state, close);
			return { kind: 'modulus', inner, isClosed };
		}
		const inner = parseList(state, close);
		const isClosed = expectClose(state, close);
		return { kind: 'group', open, inner, isClosed };
	}

	function parseIdentifier(state, token) {
		const value = token.value;
		const tokenNext = peek(state);
		const isParenGlued = Boolean(tokenNext) && tokenNext.type === 'open' && tokenNext.value === '(' && !tokenNext.spaceBefore;
		const isScriptNext = isOp(tokenNext, '_') || isOp(tokenNext, '^');
		if (value in mapBigOperator && isScriptNext && !(value in mapFunction && !isOp(tokenNext, '_'))) {
			return parseBigOperator(state, value);
		}
		if (isParenGlued && value === 'C') {
			const call = { kind: 'call', name: value, ...parseArguments(state) };
			return call;
		}
		if (isParenGlued) {
			return { kind: 'call', name: value, ...parseArguments(state) };
		}
		return { kind: 'symbol', value };
	}

	function parseBigOperator(state, name) {
		const node = { kind: 'bigOperator', name, sub: null, sup: null, body: null };
		/* Maple style: Sum_(body, k, condition) */
		if (isOp(peek(state), '_') && peek(state, 1) && peek(state, 1).type === 'open' && peek(state, 1).value === '(' && !peek(state, 1).spaceBefore) {
			take(state);
			const { listArgument } = parseArguments(state);
			if (listArgument.length < 2) {
				throw new ErrorParse('Sum_( ) needs a body and a range');
			}
			const listCondition = listArgument.slice(1).filter((argument) => !(argument.kind === 'symbol' && argument.value.length === 1));
			node.body = listArgument[0];
			node.sub = (listCondition.length > 1 && { kind: 'list', listItem: listCondition, listSeparator: listCondition.slice(1).map(() => 'comma') }) || listCondition[0] || listArgument[1];
			return node;
		}
		while (isOp(peek(state), '_') || isOp(peek(state), '^')) {
			const script = take(state).value;
			const parsed = parseScript(state);
			if (script === '_') {
				node.sub = parsed;
			} else {
				node.sup = parsed;
			}
		}
		if (startsOperand(state, peek(state)) || (peek(state) && peek(state).type === 'op' && (peek(state).value in mapAdditive || peek(state).value === '|' || peek(state).value === '!'))) {
			node.body = parseMultiplicative(state);
		}
		return node;
	}

	/* ------------------------------------------------------------------ LaTeX emitter */

	function escapeText(text) {
		return text.replace(/[\\{}$&#^_%~]/g, (character) => {
			const mapEscape = { '\\': '\\textbackslash{}', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}' };
			return mapEscape[character] || `\\${character}`;
		});
	}

	function latexSymbol(value) {
		if (value in mapGreek) {
			return mapGreek[value];
		}
		if (value in mapConstant) {
			return mapConstant[value];
		}
		if (value in mapFunction) {
			return mapFunction[value];
		}
		if (/^A\d{6}$/.test(value)) {
			return latexAnumber(value);
		}
		if (value.length === 1 || /^[A-Za-z]\d+$/.test(value) || /^[a-z]{2}$/.test(value)) {
			return value;
		}
		/* Temml 0.13 truncates \mathrm{} at a letter-digit boundary; \text{} is safe. */
		if (/\d/.test(value)) {
			return `\\text{${value}}`;
		}
		return `\\mathrm{${value}}`;
	}

	function latexAnumber(value) {
		/* Not \\text{}: MathML treats <mtext> as space-like, which strips the spacing of a
		   neighbouring "=". An upright A followed by the digits is an ordinary <mrow>. */
		return `\\data{anumber=${value}}{\\mathrm{A}${value.slice(1)}}`;
	}

	/* Does a node draw taller than a line of text? Then its brackets should stretch. */
	function isTall(node, context) {
		if (!node || typeof node !== 'object' || context.isScript) {
			return false;
		}
		if (node.kind === 'fraction' || node.kind === 'bigOperator') {
			return true;
		}
		if (node.kind === 'call' && typeof node.name === 'string' && (['binomial', 'Binomial', 'sqrt'].includes(node.name) || (node.name === 'C' && node.listArgument.length === 2))) {
			return true;
		}
		if (node.kind === 'power' || node.kind === 'subscript') {
			return isTall(node.base, context);
		}
		return Object.entries(node).some(([key, child]) => key !== 'name' && (Array.isArray(child) && child.some((item) => isTall(item, context)) || (child && typeof child === 'object' && !Array.isArray(child) && isTall(child, context))));
	}

	function containsFraction(node) {
		if (!node || typeof node !== 'object') {
			return false;
		}
		if (node.kind === 'fraction') {
			return true;
		}
		if (node.kind === 'power' || node.kind === 'subscript') {
			return containsFraction(node.base);
		}
		return Object.values(node).some((child) => (Array.isArray(child) && child.some(containsFraction)) || (child && typeof child === 'object' && !Array.isArray(child) && containsFraction(child)));
	}

	function bracket(open, close, inner, isBig, isClosed) {
		if (isBig) {
			return `\\left${open}${inner}\\right${(isClosed && close) || '.'}`;
		}
		return `${open}${inner}${(isClosed && close) || ''}`;
	}

	/* Drop the outer parentheses when position already shows the grouping. */
	function latexStripped(node, context) {
		if (node && node.kind === 'group' && node.open === '(' && node.inner) {
			return latex(node.inner, context);
		}
		return latex(node, context);
	}

	/* (1/6) Sum ...: parentheses around a lone fraction add nothing once it is drawn as a fraction. */
	function latexOperand(node, context) {
		if (!context.isScript && node.kind === 'group' && node.open === '(' && node.isClosed && node.inner && node.inner.kind === 'fraction') {
			return latex(node.inner, context);
		}
		return latex(node, context);
	}

	function latexList(node, context, separatorComma) {
		const mapSeparator = { comma: separatorComma, semi: ';\\ ', colon: '\\colon ' };
		return node.listItem.map((item, index) => {
			const separator = (index > 0 && mapSeparator[node.listSeparator[index - 1]]) || '';
			return separator + latex(item, context);
		}).join('');
	}

	function firstCharacterOf(latexString) {
		return latexString.replace(/^(\\left|\{|\\displaystyle\s*)+/, '').charAt(0);
	}

	function separatorProduct(operator, left, right, latexLeft, latexRight) {
		if (operator === 'times') {
			return '\\times ';
		}
		if (operator === 'mod') {
			return '\\bmod ';
		}
		const isDigitRight = /\d/.test(firstCharacterOf(latexRight)) || right.kind === 'fraction' || right.kind === 'unary';
		const isDigitLeft = /\d$/.test(latexLeft) || left.kind === 'fraction';
		if (left.kind === 'text' || right.kind === 'text') {
			return '\\ ';
		}
		if ((right.kind === 'dots' || left.kind === 'dots') && operator === 'juxtapose') {
			return '';
		}
		if (right.kind === 'dots' || left.kind === 'dots') {
			return '\\, ';
		}
		if (isDigitRight && (isDigitLeft || operator === '*')) {
			return '\\cdot ';
		}
		if (operator === 'juxtapose') {
			return '';
		}
		if (right.kind === 'group' || right.kind === 'modulus' || (isDigitLeft && left.kind === 'number')) {
			return (right.kind === 'modulus' && ' ') || '';
		}
		return '\\, ';
	}

	function latexBigOperator(node, context) {
		const operator = mapBigOperator[node.name];
		const contextScript = { ...context, isScript: true };
		let sub = node.sub;
		let sup = node.sup && latexStripped(node.sup, contextScript);
		let latexSub = null;
		const isIntegral = operator === '\\int';
		const isRangeRelation = (item) => item && item.kind === 'relation' && item.listOperator.length === 1 && item.listOperator[0] === '=' && item.listOperand[1].kind === 'range';
		if (sub && isRangeRelation(sub) && !sup && sub.listOperand[1].high) {
			const range = sub.listOperand[1];
			latexSub = (isIntegral && latex(range.low, contextScript)) || `${latex(sub.listOperand[0], contextScript)}=${latex(range.low, contextScript)}`;
			sup = latex(range.high, contextScript);
		} else if (sub && sub.kind === 'list' && sub.listSeparator.every((separator) => separator === 'comma')) {
			const listRow = sub.listItem.map((item) => {
				if (isRangeRelation(item) && item.listOperand[1].high) {
					return `${latex(item.listOperand[1].low, contextScript)}\\le ${latex(item.listOperand[0], contextScript)}\\le ${latex(item.listOperand[1].high, contextScript)}`;
				}
				return latex(item, contextScript);
			});
			latexSub = `\\substack{${listRow.join('\\\\')}}`;
		} else if (sub) {
			latexSub = latex(sub, contextScript);
		}
		let latexBody = '';
		if (node.body) {
			const body = node.body;
			const isDifferentialLast = isIntegral && body.kind === 'product' && body.listFactor[body.listFactor.length - 1].kind === 'symbol' && /^d[a-z]$/.test(body.listFactor[body.listFactor.length - 1].value);
			if (isDifferentialLast) {
				const listFactor = body.listFactor.slice(0, -1);
				const differential = body.listFactor[body.listFactor.length - 1].value;
				const bodyRest = (listFactor.length === 1 && listFactor[0]) || { kind: 'product', listFactor, listOperator: body.listOperator.slice(0, -1) };
				latexBody = `${latex(bodyRest, context)}\\,\\mathrm{d}${differential.charAt(1)}`;
			} else {
				latexBody = latex(body, context);
			}
		}
		const latexScripts = ((latexSub !== null && `_{${latexSub}}`) || '') + ((sup && `^{${sup}}`) || '');
		return `${operator}${latexScripts} ${latexBody}`;
	}

	function latexCall(node, context) {
		const listArgument = node.listArgument;
		const isBig = listArgument.some((argument) => isTall(argument, context));
		const latexArguments = () => listArgument.map((argument) => latex(argument, context)).join(', ');
		const parens = (inner) => bracket('(', ')', inner, isBig, node.isClosed);
		if (typeof node.name !== 'string') {
			return `{${latex(node.name, context)}}${parens(latexArguments())}`;
		}
		const name = node.name;
		const countArgument = listArgument.length;
		if (name === 'sqrt' && countArgument === 1) {
			return `\\sqrt{${latexStripped(listArgument[0], context)}}`;
		}
		if ((name === 'binomial' || name === 'Binomial' || name === 'C') && countArgument === 2) {
			const command = (context.isScript && '\\tbinom') || '\\binom';
			return `${command}{${latex(listArgument[0], context)}}{${latex(listArgument[1], context)}}`;
		}
		if ((name === 'floor' || name === 'Floor') && countArgument === 1) {
			return bracket('\\lfloor ', '\\rfloor ', latex(listArgument[0], context), isBig, node.isClosed);
		}
		if ((name === 'ceiling' || name === 'ceil') && countArgument === 1) {
			return bracket('\\lceil ', '\\rceil ', latex(listArgument[0], context), isBig, node.isClosed);
		}
		if (name === 'abs' && countArgument === 1) {
			return bracket('|', '|', latex(listArgument[0], context), isBig, node.isClosed);
		}
		const latexName = (/^A\d{6}$/.test(name) && latexAnumber(name)) || mapFunction[name] || mapGreek[name] || (name.length === 1 && name) || (/^[A-Za-z]\d+$/.test(name) && name) || `\\operatorname{${name}}`;
		return `${latexName}${parens(latexArguments())}`;
	}

	function latex(node, context) {
		if (node === null) {
			return '';
		}
		const handlers = {
			number: () => node.value,
			symbol: () => latexSymbol(node.value),
			text: () => `\\text{${escapeText(node.value)}}`,
			anumber: () => latexAnumber(node.value),
			dots: () => (context.isAdditive && '\\cdots ') || '\\ldots ',
			group: () => {
				const mapBracket = { '(': ['(', ')'], '[': ['[', ']'], '{': ['\\{', '\\}'] };
				const [open, close] = mapBracket[node.open];
				const inner = (node.inner && latex(node.inner, { ...context, isAdditive: false })) || '';
				return bracket(open, close, inner, isTall(node.inner, context), node.isClosed);
			},
			modulus: () => `\\pmod{${latex(node.inner, context)}}`,
			absolute: () => bracket('|', '|', latex(node.inner, context), isTall(node.inner, context), true),
			cardinality: () => `\\#${latex(node.operand, context)}`,
			subfactorial: () => `{!}${latex(node.operand, context)}`,
			factorial: () => `${latex(node.operand, context)}${(node.isDouble && '!!') || '!'}`,
			prime: () => `${latex(node.operand, context)}'`,
			call: () => latexCall(node, context),
			bigOperator: () => latexBigOperator(node, context),
			subscript: () => `{${latex(node.base, context)}}_{${latexStripped(node.script, { ...context, isScript: true })}}`,
			power: () => `{${latex(node.base, context)}}^{${latexStripped(node.exponent, { ...context, isScript: true })}}`,
			unary: () => `${mapAdditive[node.operator]}${latex(node.operand, context)}`,
			fraction: () => {
				if (context.isScript) {
					return `${latex(node.numerator, context)}/${latex(node.denominator, context)}`;
				}
				const command = (containsFraction(node.denominator) && '\\cfrac') || '\\frac';
				if (node.numerator.kind === 'unary') {
					return `${mapAdditive[node.numerator.operator]}${command}{${latexStripped(node.numerator.operand, context)}}{${latexStripped(node.denominator, context)}}`;
				}
				return `${command}{${latexStripped(node.numerator, context)}}{${latexStripped(node.denominator, context)}}`;
			},
			product: () => {
				const listLatex = node.listFactor.map((factor) => (factor.kind === 'dots' && '\\ldots ') || latexOperand(factor, context));
				return listLatex.reduce((accumulator, latexFactor, index) => {
					if (index === 0) {
						return latexFactor;
					}
					const separator = separatorProduct(node.listOperator[index - 1], node.listFactor[index - 1], node.listFactor[index], listLatex[index - 1], latexFactor);
					return accumulator + separator + latexFactor;
				}, '');
			},
			additive: () => {
				const contextAdditive = { ...context, isAdditive: true };
				return node.listTerm.map((term, index) => {
					const operator = (index > 0 && ` ${mapAdditive[node.listOperator[index - 1]]} `) || '';
					return operator + latex(term, contextAdditive);
				}).join('');
			},
			relation: () => node.listOperand.map((operand, index) => {
				const operator = (index > 0 && ` ${mapRelation[node.listOperator[index - 1]]} `) || '';
				return operator + latex(operand, { ...context, isAdditive: true });
			}).join(''),
			range: () => `${latex(node.low, context)},\\ldots,${latex(node.high, context)}`,
			list: () => latexList(node, context, ', '),
		};
		return handlers[node.kind]();
	}

	/* Split the top of the tree into chunks so a browser can wrap a long line between them:
	   at top-level commas, relations, and the + and - of a top-level sum. */
	function chunksFromTree(root) {
		const context = { isScript: false, isAdditive: false };
		const chunksOfAdditive = (node, lead) => {
			if (node.kind === 'additive') {
				return node.listTerm.map((term, index) => {
					const operator = (index === 0 && lead) || (index > 0 && mapAdditive[node.listOperator[index - 1]]) || '';
					const prefix = (operator && `{}${operator} `) || '';
					return { latex: prefix + latex(term, { ...context, isAdditive: true }), gap: '' };
				});
			}
			const prefix = (lead && `{}${lead} `) || '';
			return [{ latex: prefix + latex(node, { ...context, isAdditive: Boolean(lead) }), gap: '' }];
		};
		const chunksOfRelation = (node) => {
			if (node.kind !== 'relation') {
				return chunksOfAdditive(node, '');
			}
			return node.listOperand.flatMap((operand, index) => {
				const lead = (index > 0 && mapRelation[node.listOperator[index - 1]]) || '';
				return chunksOfAdditive(operand, lead);
			});
		};
		if (root.kind === 'list' && root.listSeparator.every((separator) => separator === 'comma')) {
			return root.listItem.flatMap((item, index) => {
				const chunks = chunksOfRelation(item);
				if (index < root.listItem.length - 1) {
					chunks[chunks.length - 1].latex += ',';
				}
				if (index > 0) {
					chunks[0].gap = ' ';
				}
				return chunks;
			});
		}
		return chunksOfRelation(root);
	}

	/* ------------------------------------------------------------------ entry points */

	function sourceOfTokens(listToken) {
		return listToken.map((token) => token.raw).join('');
	}

	/* `render(latexString)` must throw on failure; it is how we learn a span is not safe.
	   It is optional so the module can be used without an engine (tests, debugging). */
	function convertPieces(listPiece, render, onFailure) {
		const textWhole = listPiece.map((piece) => piece.text).join('');
		const listToken = lexPieces(listPiece);
		const listSpan = (isLineVerbatim(textWhole.replace(/^\n\s*/, '')) && []) || findSpans(listToken, 0, listToken.length)
			.map((span) => trimSpan(listToken, span))
			.filter((span) => span.end > span.start && isSpanStrong(listToken, span));
		const listMath = listSpan.flatMap((span) => {
			const listTokenSpan = listToken.slice(span.start, span.end);
			try {
				const tree = parseSpan(listTokenSpan);
				const chunks = chunksFromTree(tree);
				if (render) {
					chunks.forEach((chunk) => {
						chunk.rendered = render(chunk.latex);
					});
				}
				return [{ ...span, chunks, source: sourceOfTokens(listTokenSpan) }];
			} catch (error) {
				if (onFailure) {
					onFailure(sourceOfTokens(listTokenSpan), error);
				}
				if (error instanceof ErrorParse || render) {
					return [];
				}
				throw error;
			}
		});
		const pushSource = (listTarget, token) => {
			if (token.type === 'anumber' || token.type === 'opaque') {
				listTarget.push({ kind: 'piece', idPiece: token.idPiece });
				return;
			}
			const last = listTarget[listTarget.length - 1];
			if (last && last.kind === 'source' && last.idPiece === token.idPiece) {
				last.text += token.raw;
			} else {
				listTarget.push({ kind: 'source', idPiece: token.idPiece, text: token.raw });
			}
		};
		const listSegment = [];
		let index = 0;
		listMath.forEach((math) => {
			listToken.slice(index, math.start).forEach((token) => pushSource(listSegment, token));
			const listPart = [];
			listToken.slice(math.start, math.end).forEach((token) => pushSource(listPart, token));
			listSegment.push({ kind: 'math', source: math.source, chunks: math.chunks, listPart });
			index = math.end;
		});
		listToken.slice(index).forEach((token) => pushSource(listSegment, token));
		return listSegment;
	}

	/* Convenience for tests: one plain string in, list of LaTeX strings out. */
	function latexOfFormula(text) {
		const listToken = lexPieces([{ kind: 'text', text }]);
		return chunksFromTree(parseSpan(listToken)).map((chunk) => chunk.latex).join(' ');
	}

	const api = { convertPieces, latexOfFormula, lexPieces, findSpans, isLineVerbatim, parseSpan, chunksFromTree, ErrorParse, setOperatorStrong };
	if (typeof module === 'object' && module.exports) {
		module.exports = api;
	} else {
		rootGlobal.oeisToLatex = api;
	}
}(globalThis));
