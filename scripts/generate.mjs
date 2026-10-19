#!/usr/bin/env node
// Generates the Skwirrel API v3 docs from core's OpenRPC discovery document.
//
//   node scripts/generate.mjs --url https://demo.skwirrel.dev   # ask a core install
//   node scripts/generate.mjs --input discover.json            # use a saved document
//
// Writes openrpc/, openapi/, postman/ and bruno/ (all generated, never edit by
// hand). Nothing is written unless the whole build succeeds.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMAINS } from './domains.mjs';

const API_VERSION = '3';
const TITLE = 'Skwirrel PIM API';
const OUTPUT_DIRS = ['openrpc', 'openapi', 'postman', 'bruno'];
const SWAGGER_UI_VERSION = '5.17.14';

const ENVIRONMENTS = [
	{ key: 'production', label: 'Production', domain: 'skwirrel.eu' },
	{ key: 'development', label: 'Development', domain: 'skwirrel.dev' },
];

const URL_TEMPLATE = 'https://{{customer}}.{{domain}}/jsonrpc';
const TOKEN_URL_TEMPLATE = 'https://{{customer}}.{{domain}}/oauth2/token';

const INTRO = `Skwirrel PIM API, version 3. JSON-RPC 2.0 over HTTPS.

- Every call is \`POST https://{customer}.skwirrel.eu/jsonrpc\` (production) or \`https://{customer}.skwirrel.dev/jsonrpc\` (dev/test). The method name goes in the request body.
- Send the header \`X-Skwirrel-Api-Version: 3\`. Without it, core answers with the latest version.
- Authenticate with a static token in the header \`X-Skwirrel-Api-Token\` (default), or with OAuth2 client credentials: \`POST /oauth2/token\` with \`grant_type=client_credentials\`, \`client_id\` and \`client_secret\`, then send \`Authorization: Bearer <access_token>\`. Access tokens are valid for one hour.
- A Skwirrel administrator grants access per method. Without a grant, or with a wrong token, the call returns a JSON-RPC error.`;

// ---------------------------------------------------------------- input

/** Accepts a raw OpenRPC document or a JSON-RPC response that wraps one. */
export function unwrap(input) {
	if (input && input.error) {
		throw new Error(`Core returned a JSON-RPC error: ${input.error.message ?? JSON.stringify(input.error)}`);
	}
	const doc = input && input.result ? input.result : input;
	if (!doc || !Array.isArray(doc.methods)) {
		throw new Error('Input is not an OpenRPC document (no "methods" list).');
	}
	return doc;
}

function domainIndex() {
	const index = new Map();
	for (const [domain, names] of Object.entries(DOMAINS)) {
		for (const name of names) index.set(name, domain);
	}
	return index;
}

function checkMethods(doc, index) {
	const served = new Set(doc.methods.map((m) => m.name));
	const unmapped = [...served].filter((n) => !index.has(n)).sort();
	const missing = [...index.keys()].filter((n) => !served.has(n)).sort();
	const problems = [];
	if (unmapped.length) {
		problems.push(`Methods not in scripts/domains.mjs (new core method, or an addon is active on the source install): ${unmapped.join(', ')}`);
	}
	if (missing.length) {
		problems.push(`Core methods missing from the input (wrong API version or an old core?): ${missing.join(', ')}`);
	}
	if (problems.length) throw new Error(problems.join('\n'));
}

// ---------------------------------------------------------------- helpers

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

function exampleParams(example) {
	return Object.fromEntries((example?.params ?? []).map((p) => [p.name, p.value]));
}

function envelope(method, params) {
	return { jsonrpc: '2.0', method, params, id: 1 };
}

function typeLabel(schema = {}) {
	const types = [].concat(schema.type ?? 'any').filter((t) => t !== 'null');
	const nullable = [].concat(schema.type ?? []).includes('null');
	const label = types
		.map((t) => (t === 'array' && schema.items ? `${typeLabel(schema.items)}[]` : t))
		.join(' | ');
	return nullable ? `${label} (nullable)` : label;
}

const cell = (text) => String(text ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/** Markdown description of a method: what it does, its parameters and examples. */
function methodDocs(method) {
	const lines = [method.description || '', ''];
	if (method.params.length) {
		lines.push('| Parameter | Type | Required | Description |', '|---|---|---|---|');
		for (const p of method.params) {
			lines.push(`| \`${p.name}\` | ${cell(typeLabel(p.schema))} | ${p.required ? 'yes' : 'no'} | ${cell(p.description)} |`);
		}
	} else {
		lines.push('No parameters.');
	}
	for (const ex of method.examples ?? []) {
		lines.push('', `**Example: ${ex.name}**${ex.description ? `. ${ex.description}` : ''}`, '', '```json', JSON.stringify(envelope(method.name, exampleParams(ex)), null, 2), '```');
		if (ex.result) {
			lines.push('', 'Result:', '', '```json', JSON.stringify(ex.result.value, null, 2), '```');
		}
	}
	return lines.join('\n').trim();
}

// ---------------------------------------------------------------- OpenRPC

function buildOpenRpc(doc, methods) {
	return {
		openrpc: doc.openrpc ?? '1.2.6',
		info: { title: TITLE, version: `${API_VERSION}.0.0`, description: INTRO },
		servers: ENVIRONMENTS.map((env) => ({
			name: env.label,
			url: `https://{customer}.${env.domain}/jsonrpc`,
			variables: { customer: { default: 'demo', description: 'Your Skwirrel tenant name' } },
		})),
		methods: methods.map(({ domain, method }) => ({
			name: method.name,
			tags: [{ name: domain }],
			...Object.fromEntries(Object.entries(method).filter(([k]) => k !== 'name' && k !== 'tags')),
		})),
	};
}

// ---------------------------------------------------------------- OpenAPI

function paramsSchema(method) {
	const schema = { type: 'object', properties: {} };
	for (const p of method.params) {
		schema.properties[p.name] = { ...p.schema, ...(p.description ? { description: p.description } : {}) };
	}
	const required = method.params.filter((p) => p.required).map((p) => p.name);
	if (required.length) schema.required = required;
	return schema;
}

function errorResponse(description, code, message, data) {
	return {
		description,
		content: {
			'application/json': {
				schema: { $ref: '#/components/schemas/JsonRpcErrorResponse' },
				example: { jsonrpc: '2.0', error: { code, message, data }, id: 1 },
			},
		},
	};
}

function buildOpenApi(methods) {
	const paths = {};
	for (const { domain, method } of methods) {
		const examples = method.examples ?? [];
		const requestExamples = {};
		const responseExamples = {};
		examples.forEach((ex, i) => {
			const key = `example${i + 1}`;
			requestExamples[key] = { summary: ex.name, value: envelope(method.name, exampleParams(ex)) };
			if (ex.result) {
				responseExamples[key] = { summary: ex.name, value: { jsonrpc: '2.0', result: ex.result.value, id: 1 } };
			}
		});
		if (!examples.length) {
			requestExamples.example1 = { summary: 'Request', value: envelope(method.name, {}) };
		}

		paths[`/jsonrpc#${method.name}`] = {
			post: {
				operationId: method.name,
				tags: [domain],
				summary: method.description || method.name,
				description: `Sent as \`POST /jsonrpc\` with \`"method": "${method.name}"\` in the body.\n\n${methodDocs(method)}`,
				parameters: [{
					name: 'X-Skwirrel-Api-Version',
					in: 'header',
					required: true,
					schema: { type: 'string', const: API_VERSION, default: API_VERSION },
				}],
				requestBody: {
					required: true,
					content: {
						'application/json': {
							schema: {
								type: 'object',
								required: ['jsonrpc', 'method', 'params', 'id'],
								properties: {
									jsonrpc: { type: 'string', const: '2.0' },
									method: { type: 'string', enum: [method.name] },
									params: paramsSchema(method),
									id: { type: ['integer', 'string'] },
								},
							},
							examples: requestExamples,
						},
					},
				},
				responses: {
					200: {
						description: 'JSON-RPC response. On success `result` is set, on failure `error`.',
						content: {
							'application/json': {
								schema: {
									oneOf: [
										{
											type: 'object',
											required: ['jsonrpc', 'result', 'id'],
											properties: {
												jsonrpc: { type: 'string', const: '2.0' },
												result: method.result?.schema ?? { type: 'object' },
												id: { type: ['integer', 'string'] },
											},
										},
										{ $ref: '#/components/schemas/JsonRpcErrorResponse' },
									],
								},
								...(Object.keys(responseExamples).length ? { examples: responseExamples } : {}),
							},
						},
					},
					401: { $ref: '#/components/responses/Unauthorized' },
					403: { $ref: '#/components/responses/Forbidden' },
				},
			},
		};
	}

	return {
		openapi: '3.1.0',
		info: {
			title: TITLE,
			version: `${API_VERSION}.0.0`,
			description: `${INTRO}\n\nJSON-RPC has one URL for all methods. Each method is listed here as \`/jsonrpc#<method>\`: the part after \`#\` is never sent, so every call goes to \`POST /jsonrpc\`.`,
			license: { name: 'Apache 2.0', identifier: 'Apache-2.0' },
		},
		servers: ENVIRONMENTS.map((env) => ({
			url: `https://{customer}.${env.domain}`,
			description: env.label,
			variables: { customer: { default: 'demo', description: 'Your Skwirrel tenant name' } },
		})),
		tags: Object.entries(DOMAINS).map(([name, names]) => ({ name, description: `${names.length} methods` })),
		security: [{ staticToken: [] }, { oauth2: [] }],
		paths,
		components: {
			securitySchemes: {
				staticToken: {
					type: 'apiKey',
					in: 'header',
					name: 'X-Skwirrel-Api-Token',
					description: 'Static API token (default). Ask your Skwirrel administrator for one.',
				},
				oauth2: {
					type: 'oauth2',
					description: 'OAuth2 client credentials. Access tokens are valid for one hour.',
					flows: { clientCredentials: { tokenUrl: '/oauth2/token', scopes: {} } },
				},
			},
			responses: {
				Unauthorized: errorResponse('Wrong, expired or missing token.', -32001, 'Unauthorized', 'Failed to authenticate client'),
				Forbidden: errorResponse('The client has no grant for this method.', -32002, 'Method is forbidden', 'Method getProducts (v3) is not allowed for this client'),
			},
			schemas: {
				JsonRpcErrorResponse: {
					type: 'object',
					required: ['jsonrpc', 'error', 'id'],
					properties: {
						jsonrpc: { type: 'string', const: '2.0' },
						error: {
							type: 'object',
							required: ['code', 'message'],
							properties: {
								code: { type: 'integer' },
								message: { type: 'string' },
								data: {},
							},
						},
						id: { type: ['integer', 'string', 'null'] },
					},
				},
			},
		},
	};
}

function swaggerHtml(openapi) {
	// Inline the spec so the page also works when opened straight from disk.
	const spec = JSON.stringify(openapi).replace(/</g, '\\u003c');
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${TITLE} v${API_VERSION}</title>
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui.css">
</head>
<body>
<div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui-bundle.js"></script>
<script>
const spec = ${spec};
window.ui = SwaggerUIBundle({ spec, dom_id: '#swagger-ui', deepLinking: true });
</script>
</body>
</html>
`;
}

// ---------------------------------------------------------------- Postman

function postmanRequest(method, params) {
	return {
		method: 'POST',
		header: [
			{ key: 'Content-Type', value: 'application/json' },
			{ key: 'X-Skwirrel-Api-Version', value: API_VERSION },
		],
		body: { mode: 'raw', raw: JSON.stringify(envelope(method.name, params), null, 2), options: { raw: { language: 'json' } } },
		url: { raw: URL_TEMPLATE, protocol: 'https', host: ['{{customer}}', '{{domain}}'], path: ['jsonrpc'] },
	};
}

const kv = (pairs) => Object.entries(pairs).map(([key, value]) => ({ key, value, type: 'string' }));

function buildPostman(methods) {
	const folders = Object.keys(DOMAINS).map((domain) => ({
		name: domain,
		item: methods.filter((m) => m.domain === domain).map(({ method }) => {
			const examples = method.examples ?? [];
			return {
				name: method.name,
				request: { ...postmanRequest(method, exampleParams(examples[0])), description: methodDocs(method) },
				response: examples.filter((ex) => ex.result).map((ex) => ({
					name: ex.name,
					originalRequest: postmanRequest(method, exampleParams(ex)),
					status: 'OK',
					code: 200,
					_postman_previewlanguage: 'json',
					header: [{ key: 'Content-Type', value: 'application/json' }],
					body: JSON.stringify({ jsonrpc: '2.0', result: ex.result.value, id: 1 }, null, 2),
				})),
			};
		}),
	}));

	return {
		info: {
			name: `${TITLE} v${API_VERSION}`,
			description: `${INTRO}\n\n**Getting started:** pick the Production or Development environment, set \`customer\` to your tenant name and \`api_token\` to your static token.\n\n**OAuth2 instead:** open the collection's Authorization tab, choose OAuth 2.0 (pre-filled with client credentials and the token URL), fill \`client_id\` and \`client_secret\` in the environment, and click Get New Access Token.`,
			schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
		},
		auth: {
			type: 'apikey',
			apikey: kv({ key: 'X-Skwirrel-Api-Token', value: '{{api_token}}', in: 'header' }),
			oauth2: kv({
				grant_type: 'client_credentials',
				accessTokenUrl: TOKEN_URL_TEMPLATE,
				clientId: '{{client_id}}',
				clientSecret: '{{client_secret}}',
				client_authentication: 'body',
				tokenName: 'Skwirrel',
				addTokenTo: 'header',
			}),
		},
		item: folders,
		variable: [
			{ key: 'customer', value: 'demo' },
			{ key: 'domain', value: 'skwirrel.eu' },
		],
	};
}

function postmanEnvironment(env) {
	const value = (key, val, type = 'default') => ({ key, value: val, type, enabled: true });
	return {
		name: `Skwirrel ${env.label} (${env.domain})`,
		values: [
			value('customer', 'demo'),
			value('domain', env.domain),
			value('api_token', '', 'secret'),
			value('client_id', ''),
			value('client_secret', '', 'secret'),
		],
		_postman_variable_scope: 'environment',
	};
}

// ---------------------------------------------------------------- Bruno

const indent = (text, spaces = 2) => text.split('\n').map((l) => (l ? ' '.repeat(spaces) + l : l)).join('\n');

function bruRequest(method, seq) {
	const params = exampleParams(method.examples?.[0]);
	return `meta {
  name: ${method.name}
  type: http
  seq: ${seq}
}

post {
  url: ${URL_TEMPLATE}
  body: json
  auth: inherit
}

body:json {
${indent(JSON.stringify(envelope(method.name, params), null, 2))}
}

docs {
${indent(methodDocs(method))}
}
`;
}

function buildBruno(methods) {
	const root = 'bruno/skwirrel-api-v3';
	const files = {};
	files[`${root}/bruno.json`] = json({ version: '1', name: `${TITLE} v${API_VERSION}`, type: 'collection', ignore: ['node_modules', '.git'] });
	files[`${root}/collection.bru`] = `headers {
  X-Skwirrel-Api-Version: ${API_VERSION}
}

auth {
  mode: apikey
}

auth:apikey {
  key: X-Skwirrel-Api-Token
  value: {{api_token}}
  placement: header
}

auth:oauth2 {
  grant_type: client_credentials
  access_token_url: ${TOKEN_URL_TEMPLATE}
  client_id: {{client_id}}
  client_secret: {{client_secret}}
  scope:
}

docs {
${indent(`${INTRO}\n\n**Getting started:** pick the Production or Development environment, set \`customer\` to your tenant name and the secret \`api_token\` to your static token.\n\n**OAuth2 instead:** in the collection settings, set Auth to OAuth 2.0 (client credentials and token URL are pre-filled), fill the secrets \`client_id\` and \`client_secret\`, and fetch a token.`)}
}
`;
	for (const env of ENVIRONMENTS) {
		files[`${root}/environments/${env.label}.bru`] = `vars {
  customer: demo
  domain: ${env.domain}
}
vars:secret [
  api_token,
  client_id,
  client_secret
]
`;
	}
	Object.keys(DOMAINS).forEach((domain, i) => {
		files[`${root}/${domain}/folder.bru`] = `meta {\n  name: ${domain}\n  seq: ${i + 1}\n}\n`;
		methods.filter((m) => m.domain === domain).forEach(({ method }, j) => {
			files[`${root}/${domain}/${method.name}.bru`] = bruRequest(method, j + 1);
		});
	});
	return files;
}

// ---------------------------------------------------------------- build

/** Builds every output file in memory: { 'relative/path': 'content' }. */
export function buildAll(input) {
	const doc = unwrap(input);
	const index = domainIndex();
	checkMethods(doc, index);

	const order = Object.values(DOMAINS).flat();
	const methods = [...doc.methods]
		.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
		.map((method) => ({ domain: index.get(method.name), method }));
	const byDomainOrder = [...methods].sort((a, b) => order.indexOf(a.method.name) - order.indexOf(b.method.name));

	const openapi = buildOpenApi(methods);
	const files = {
		'openrpc/skwirrel-api-v3.openrpc.json': json(buildOpenRpc(doc, methods)),
		'openapi/skwirrel-api-v3.openapi.json': json(openapi),
		'openapi/index.html': swaggerHtml(openapi),
		'postman/skwirrel-api-v3.postman_collection.json': json(buildPostman(byDomainOrder)),
		...buildBruno(byDomainOrder),
	};
	for (const env of ENVIRONMENTS) {
		files[`postman/environments/${env.key}.postman_environment.json`] = json(postmanEnvironment(env));
	}
	return files;
}

async function fetchDiscover(baseUrl) {
	const url = `${baseUrl.replace(/\/+$/, '')}/jsonrpc`;
	let response;
	try {
		response = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'X-Skwirrel-Api-Version': API_VERSION },
			body: JSON.stringify({ jsonrpc: '2.0', method: 'rpc.discover', id: 1 }),
		});
	} catch (error) {
		throw new Error(`Could not reach core at ${url}: ${error.cause?.message ?? error.message}`);
	}
	if (!response.ok) throw new Error(`Core at ${url} answered HTTP ${response.status}`);
	return response.json();
}

function writeAll(files, outDir) {
	for (const dir of OUTPUT_DIRS) rmSync(join(outDir, dir), { recursive: true, force: true });
	for (const [path, content] of Object.entries(files)) {
		const target = join(outDir, path);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, content);
	}
}

function parseArgs(argv) {
	const args = {};
	for (let i = 0; i < argv.length; i += 2) {
		const key = argv[i]?.replace(/^--/, '');
		if (!['url', 'input', 'out'].includes(key) || argv[i + 1] === undefined) {
			throw new Error('Usage: generate.mjs (--url <core base url> | --input <discover.json>) [--out <dir>]');
		}
		args[key] = argv[i + 1];
	}
	if (!args.url === !args.input) throw new Error('Pass exactly one of --url or --input.');
	return args;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const outDir = resolve(args.out ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
	const input = args.url ? await fetchDiscover(args.url) : JSON.parse(readFileSync(args.input, 'utf8'));
	const files = buildAll(input);
	writeAll(files, outDir);
	console.log(`Wrote ${Object.keys(files).length} files for ${unwrap(input).methods.length} methods to ${outDir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(error.message);
		process.exit(1);
	});
}
