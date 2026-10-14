// The templates of this repository, read and checked: what pethost.dev's build reads to draw a
// page per template and the catalog the Pethost panel's New project lists, and what every pull
// request is checked with.
//
//   node catalog.mjs          checks the templates, and says what is wrong
//
// A template is a directory named by its id: compose.yaml, logo.svg or logo.png, and
// template.json (README.md says what each holds). Beside them: languages.json, the languages
// every text is written in; fields.json, the fields a template may ask the person to fill in;
// order.json, the templates listed first, in that order, before the rest by id.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** A template's id: also the project's, and the first name of its address. */
const idRule = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const idLength = 40;

/** A variable's name in the project's .env. */
const variableRule = /^[A-Z][A-Z0-9_]*$/;

/** Random bytes a secret may be made of, written in hex: twice as many characters. */
const secretBytes = { min: 8, max: 64 };

const templateKeys = ['name', 'emoji', 'route', 'variables', 'texts'];

/** The templates in their order, each with its compose.yaml's text and its logo's file name, and
 *  what they share: the languages and the fields. Throws with every problem found. */
export function readCatalog(dir) {
	const problems = [];
	const read = (file) => readJson(join(dir, file), file, problems);

	const languages = read('languages.json') ?? [];
	const fields = read('fields.json') ?? {};
	const order = read('order.json') ?? [];
	checkFields(fields, languages, problems);

	const ids = readdirSync(dir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
		.map((entry) => entry.name)
		.sort();
	checkOrder(order, ids, problems);

	const listed = [...order.filter((id) => ids.includes(id)), ...ids.filter((id) => !order.includes(id))];
	const templates = listed.map((id) => readTemplate(dir, id, { languages, fields }, problems));

	if (problems.length > 0) throw new Error(`The templates have ${problems.length} problems:\n${problems.join('\n')}`);
	return { languages, fields, templates };
}

function readTemplate(dir, id, shared, problems) {
	const own = (problem) => problems.push(`${id}: ${problem}`);
	if (!idRule.test(id) || id.length > idLength) own(`the id is lower-case letters and digits, with hyphens between them, ${idLength} at most`);

	const files = readdirSync(join(dir, id));
	const logos = files.filter((file) => file === 'logo.svg' || file === 'logo.png');
	const extra = files.filter((file) => !['compose.yaml', 'template.json', 'logo.svg', 'logo.png'].includes(file));
	if (logos.length !== 1) own('has logo.svg or logo.png, one of them');
	if (extra.length > 0) own(`has only compose.yaml, template.json and the logo, not ${extra.join(', ')}`);

	const compose = existsSync(join(dir, id, 'compose.yaml')) ? readFileSync(join(dir, id, 'compose.yaml'), 'utf8') : '';
	if (!compose) own('has no compose.yaml');

	const template = readJson(join(dir, id, 'template.json'), `${id}/template.json`, problems) ?? {};
	checkTemplate(template, compose, shared, own);

	return { id, ...template, compose, logo: logos[0] };
}

function checkTemplate(template, compose, { languages, fields }, own) {
	for (const key of Object.keys(template)) {
		if (!templateKeys.includes(key)) own(`template.json has no ${key}: it has ${templateKeys.join(', ')}`);
	}
	if (!text(template.name)) own('name is the app’s own name');
	if (!text(template.emoji)) own('emoji is the project’s emoji');
	if (template.route !== undefined) checkRoute(template.route, compose, own);

	if (!Array.isArray(template.variables)) own('variables is a list, empty when the app needs none');
	else checkVariables(template.variables, compose, fields, own);

	checkTexts(template.texts, languages, own);
}

function checkRoute(route, compose, own) {
	if (!text(route.service) || !Number.isInteger(route.port) || route.port < 1 || route.port > 65535)
		own('route is the service and the port its page is served at: {"service": "app", "port": 8080}');
	else if (!new RegExp(`^  ${route.service}:`, 'm').test(compose)) own(`route names ${route.service}, a service compose.yaml lacks`);
}

function checkVariables(variables, compose, fields, own) {
	// A service with env_file: .env reads every variable.
	const readsAll = /env_file:/.test(compose);
	const names = new Set();
	for (const variable of variables) {
		const { name, ...source } = variable;
		const where = `variable ${name}`;
		if (!variableRule.test(name ?? '')) own(`${where}: a name is capitals, digits and underscores`);
		if (names.has(name)) own(`${where} is listed twice`);
		names.add(name);

		if (!readsAll && !new RegExp(`\\$\\{?${name}\\b`).test(compose)) own(`${where} is read nowhere in compose.yaml`);
		checkSource(source, fields, (problem) => own(`${where}: ${problem}`));
	}
}

/** Where a variable's value comes from: the project's address, random bytes, or a field. */
function checkSource(source, fields, own) {
	const kinds = ['from', 'secret', 'ask'].filter((kind) => kind in source);
	if (kinds.length !== 1) return own('has one of from, secret and ask');

	const allowed = { from: ['from'], secret: ['secret'], ask: ['ask', 'optional'] }[kinds[0]];
	const extra = Object.keys(source).filter((key) => !allowed.includes(key));
	if (extra.length > 0) own(`has no ${extra.join(', ')}`);

	if ('from' in source && !['url', 'host'].includes(source.from)) own('from is "url" or "host"');
	if ('secret' in source && !(Number.isInteger(source.secret) && source.secret >= secretBytes.min && source.secret <= secretBytes.max))
		own(`secret is a number of random bytes, from ${secretBytes.min} to ${secretBytes.max}`);
	if ('ask' in source && !(source.ask in fields)) own(`ask is a field of fields.json: ${Object.keys(fields).join(', ')}`);
	if ('optional' in source && source.optional !== true) own('optional is true, or left out');
}

function checkTexts(texts, languages, own) {
	if (typeof texts !== 'object' || texts === null) return own('texts has the description and the notes in every language');

	for (const code of languages) {
		const { description, notes, ...extra } = texts[code] ?? {};
		if (!text(description)) own(`texts.${code}.description is missing`);
		if (!text(notes)) own(`texts.${code}.notes is missing`);
		if (Object.keys(extra).length > 0) own(`texts.${code} has only description and notes`);
		if (/\{(?!host\})[^}]*\}/.test(notes ?? '')) own(`texts.${code}.notes holds no {…} but {host}`);
	}
	for (const code of Object.keys(texts)) {
		if (!languages.includes(code)) own(`texts.${code}: ${code} is not in languages.json`);
	}
}

function checkFields(fields, languages, problems) {
	for (const [name, field] of Object.entries(fields)) {
		const own = (problem) => problems.push(`fields.json: ${name}: ${problem}`);
		if (field.type !== undefined && !['password', 'key'].includes(field.type)) own('type is "password" or "key", or left out');
		if (field.placeholder !== undefined && !text(field.placeholder)) own('placeholder is a text');
		for (const code of languages) {
			if (!text(field.label?.[code])) own(`label.${code} is missing`);
		}
	}
}

function checkOrder(order, ids, problems) {
	if (!Array.isArray(order)) return problems.push('order.json is a list of ids');
	for (const id of order) {
		if (!ids.includes(id)) problems.push(`order.json: ${id} is no template here`);
	}
	if (new Set(order).size !== order.length) problems.push('order.json lists an id twice');
}

function readJson(path, name, problems) {
	try {
		return JSON.parse(readFileSync(path, 'utf8'));
	} catch (error) {
		problems.push(`${name}: ${error.code === 'ENOENT' ? 'is missing' : error.message}`);
		return undefined;
	}
}

const text = (value) => typeof value === 'string' && value.trim() !== '';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	try {
		const { templates } = readCatalog(fileURLToPath(new URL('.', import.meta.url)));
		console.log(`${templates.length} templates, every one well.`);
	} catch (error) {
		console.error(error.message);
		process.exit(1);
	}
}
