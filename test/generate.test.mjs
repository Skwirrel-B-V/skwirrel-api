import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildAll, typeLabel, writeAll } from '../scripts/generate.mjs';
import { createServer } from 'node:http';
import { DOMAINS } from '../scripts/domains.mjs';

const fixturePath = new URL('./fixtures/rpc-discover-v3.json', import.meta.url);
const discover = () => JSON.parse(readFileSync(fixturePath, 'utf8'));
const cli = new URL('../scripts/generate.mjs', import.meta.url).pathname;

const EXPECTED_METHODS = Object.values(DOMAINS).flat().sort();

test('the domain map lists exactly 62 core methods', () => {
	assert.equal(EXPECTED_METHODS.length, 62);
	assert.equal(new Set(EXPECTED_METHODS).size, 62);
});

test('OpenRPC output has exactly the 62 methods, sorted and tagged by domain', () => {
	const files = buildAll(discover());
	const doc = JSON.parse(files['openrpc/skwirrel-api-v3.openrpc.json']);
	const names = doc.methods.map((m) => m.name);
	assert.deepEqual(names, EXPECTED_METHODS);
	for (const m of doc.methods) {
		assert.equal(m.tags?.length, 1, `${m.name} has one domain tag`);
	}
	assert.match(doc.servers[0].url, /skwirrel\.eu\/jsonrpc$/);
	assert.match(doc.servers[1].url, /skwirrel\.dev\/jsonrpc$/);
});

test('no v2 leftovers in any output', () => {
	const files = buildAll(discover());
	for (const [path, content] of Object.entries(files)) {
		assert.doesNotMatch(content, /getToken|getAttachment\b|\/api\/v2/, path);
	}
});

test('two builds of the same input are identical', () => {
	assert.deepEqual(buildAll(discover()), buildAll(discover()));
});

test('a method missing from the domain map fails the build', () => {
	const doc = discover();
	doc.methods.push({ name: 'addonOnlyMethod', description: '', params: [], result: { name: 'result', schema: {} } });
	assert.throws(() => buildAll(doc), /addonOnlyMethod/);
});

test('a core method missing from the input fails the build', () => {
	const doc = discover();
	doc.methods = doc.methods.filter((m) => m.name !== 'getProducts');
	assert.throws(() => buildAll(doc), /getProducts/);
});

test('OpenAPI: 3.1, one operation per method, both servers and both auth schemes', () => {
	const api = JSON.parse(buildAll(discover())['openapi/skwirrel-api-v3.openapi.json']);
	assert.equal(api.openapi, '3.1.0');
	const ops = Object.values(api.paths).map((p) => p.post);
	assert.equal(ops.length, 62);
	assert.deepEqual(api.servers.map((s) => s.variables.customer.default), ['demo', 'demo']);
	assert.deepEqual(Object.keys(api.components.securitySchemes).sort(), ['oauth2', 'staticToken']);
	assert.equal(api.components.securitySchemes.staticToken.name, 'X-Skwirrel-Api-Token');
	assert.equal(api.components.securitySchemes.oauth2.flows.clientCredentials.tokenUrl, '/oauth2/token');
	for (const op of ops) {
		const version = op.parameters.find((p) => p.name === 'X-Skwirrel-Api-Version');
		assert.equal(version.schema.const, '3', op.operationId);
		const body = op.requestBody.content['application/json'].schema;
		assert.deepEqual(body.properties.method.enum, [op.operationId]);
		assert.deepEqual(Object.keys(op.responses), ['200', '401', '403', '429']);
	}
	assert.equal(api.components.responses.Unauthorized.content['application/json'].example.error.code, -32001);
	assert.equal(api.components.responses.Forbidden.content['application/json'].example.error.code, -32002);
});

test('Swagger UI page embeds the spec so it opens from disk', () => {
	const html = buildAll(discover())['openapi/index.html'];
	assert.match(html, /SwaggerUIBundle/);
	assert.match(html, /"operationId":"getProducts"/);
	assert.equal((html.match(/integrity="sha384-/g) ?? []).length, 2, 'both CDN files carry an SRI hash');
});

test('collections explain the error codes, including rate limiting', () => {
	const files = buildAll(discover());
	const col = JSON.parse(files['postman/skwirrel-api-v3.postman_collection.json']);
	for (const text of [col.info.description, files['bruno/skwirrel-api-v3/collection.bru']]) {
		for (const code of ['-32001', '-32002', '-32029']) assert.ok(text.includes(code), code);
	}
});

test('Postman: 62 requests in domain folders, version header, static token auth, two clean environments', () => {
	const files = buildAll(discover());
	const col = JSON.parse(files['postman/skwirrel-api-v3.postman_collection.json']);
	assert.deepEqual(col.item.map((f) => f.name), Object.keys(DOMAINS));
	const requests = col.item.flatMap((f) => f.item);
	assert.equal(requests.length, 62);
	for (const r of requests) {
		assert.ok(r.request.header.some((h) => h.key === 'X-Skwirrel-Api-Version' && h.value === '3'), r.name);
		assert.equal(r.request.url.raw, 'https://{{customer}}.{{domain}}/jsonrpc');
		const body = JSON.parse(r.request.body.raw);
		assert.equal(body.method, r.name);
		assert.ok(!('token' in body.params), r.name);
	}
	assert.equal(col.auth.type, 'apikey');
	for (const env of ['Production', 'Development']) {
		const e = JSON.parse(files[`postman/environments/${env}.postman_environment.json`]);
		const vals = Object.fromEntries(e.values.map((v) => [v.key, v.value]));
		assert.equal(vals.customer, 'demo');
		assert.equal(vals.api_token, '');
		assert.equal(vals.client_secret, '');
		assert.deepEqual(e.values.filter((v) => v.type === 'secret').map((v) => v.key), ['api_token', 'client_id', 'client_secret']);
	}
});

test('example params become the request body', () => {
	const col = JSON.parse(buildAll(discover())['postman/skwirrel-api-v3.postman_collection.json']);
	const req = col.item.flatMap((f) => f.item).find((r) => r.name === 'getProducts');
	assert.deepEqual(JSON.parse(req.request.body.raw).params, { page: 1, limit: 2 });
});

test('Bruno: one .bru per method, collection auth and version header, two environments', () => {
	const files = buildAll(discover());
	const bru = Object.keys(files).filter((p) => p.startsWith('bruno/') && p.endsWith('.bru') && !/collection\.bru|folder\.bru|environments\//.test(p));
	assert.equal(bru.length, 62);
	const collection = files['bruno/skwirrel-api-v3/collection.bru'];
	assert.match(collection, /mode: apikey/);
	assert.match(collection, /key: X-Skwirrel-Api-Token/);
	assert.match(collection, /X-Skwirrel-Api-Version: 3/);
	assert.ok(files['bruno/skwirrel-api-v3/environments/Production.bru'].includes('domain: skwirrel.eu'));
	assert.ok(files['bruno/skwirrel-api-v3/environments/Development.bru'].includes('domain: skwirrel.dev'));
	for (const p of bru) {
		assert.match(files[p], /auth: inherit/, p);
		assert.doesNotMatch(files[p], /"token"/, p);
	}
});

test('CLI writes all files from an input file', () => {
	const out = mkdtempSync(join(tmpdir(), 'skw-api-'));
	const r = spawnSync(process.execPath, [cli, '--input', fixturePath.pathname, '--out', out], { encoding: 'utf8' });
	assert.equal(r.status, 0, r.stderr);
	assert.ok(existsSync(join(out, 'openrpc/skwirrel-api-v3.openrpc.json')));
	assert.equal(readdirSync(join(out, 'bruno/skwirrel-api-v3')).length > 10, true);
});

test('CLI fails on a JSON-RPC error and leaves existing files alone', () => {
	const out = mkdtempSync(join(tmpdir(), 'skw-api-'));
	const bad = join(out, 'error.json');
	writeFileSync(bad, JSON.stringify({ jsonrpc: '2.0', error: { code: -32601, message: 'Method not found' }, id: 1 }));
	const r = spawnSync(process.execPath, [cli, '--input', bad, '--out', out], { encoding: 'utf8' });
	assert.notEqual(r.status, 0);
	assert.match(r.stderr, /Method not found/);
	assert.deepEqual(readdirSync(out), ['error.json']);
});

test('CLI leaves no staging folder behind', () => {
	const out = mkdtempSync(join(tmpdir(), 'skw-api-'));
	const r = spawnSync(process.execPath, [cli, '--input', fixturePath.pathname, '--out', out], { encoding: 'utf8' });
	assert.equal(r.status, 0, r.stderr);
	assert.deepEqual(readdirSync(out).sort(), ['bruno', 'openapi', 'openrpc', 'postman']);
});

test('CLI prints usage on --help and rejects unknown or repeated options', () => {
	const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
	assert.equal(help.status, 0);
	assert.match(help.stdout, /Usage:/);
	const bare = spawnSync(process.execPath, [cli, 'input', 'x.json'], { encoding: 'utf8' });
	assert.notEqual(bare.status, 0);
	assert.match(bare.stderr, /Unknown or incomplete option "input"/);
	const twice = spawnSync(process.execPath, [cli, '--input', 'a', '--input', 'b'], { encoding: 'utf8' });
	assert.notEqual(twice.status, 0);
	assert.match(twice.stderr, /given twice/);
});

test('CLI fails clearly when core is unreachable', () => {
	const out = mkdtempSync(join(tmpdir(), 'skw-api-'));
	const r = spawnSync(process.execPath, [cli, '--url', 'http://127.0.0.1:9', '--out', out], { encoding: 'utf8' });
	assert.notEqual(r.status, 0);
	assert.match(r.stderr, /Could not reach/);
	assert.deepEqual(readdirSync(out), []);
});

test('typeLabel reads unions, nullables and lists correctly', () => {
	assert.equal(typeLabel({ type: ['string', 'null'] }), 'string (nullable)');
	assert.equal(typeLabel({ oneOf: [{ type: 'string' }, { type: 'null' }] }), 'string (nullable)');
	assert.equal(typeLabel({ type: 'array', items: { oneOf: [{ type: 'integer' }, { type: 'string' }] } }), '(integer | string)[]');
	assert.equal(typeLabel({ type: 'array', items: { type: 'integer' } }), 'integer[]');
	assert.equal(typeLabel({ $ref: '#/components/schemas/Product' }), 'Product');
	assert.equal(typeLabel({ type: 'null' }), 'null');
});

test('a method without params still builds', () => {
	const doc = discover();
	delete doc.methods.find((m) => m.name === 'getEtimReleases').params;
	assert.doesNotThrow(() => buildAll(doc));
});

test('writeAll keeps the previous docs when the build is incomplete', () => {
	const out = mkdtempSync(join(tmpdir(), 'skw-api-'));
	writeAll(buildAll(discover()), out);
	const before = readFileSync(join(out, 'openrpc/skwirrel-api-v3.openrpc.json'), 'utf8');
	const partial = Object.fromEntries(Object.entries(buildAll(discover())).filter(([path]) => !path.startsWith('bruno/')));
	partial['openrpc/skwirrel-api-v3.openrpc.json'] = '{}';
	assert.throws(() => writeAll(partial, out), /nothing for: bruno/);
	assert.equal(readFileSync(join(out, 'openrpc/skwirrel-api-v3.openrpc.json'), 'utf8'), before);
	assert.deepEqual(readdirSync(out).sort(), ['bruno', 'openapi', 'openrpc', 'postman']);
});

test('CLI explains a non-JSON answer and leaves files alone', async () => {
	const server = createServer((req, res) => res.end('<html>login</html>'));
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	const out = mkdtempSync(join(tmpdir(), 'skw-api-'));
	try {
		const { spawn } = await import('node:child_process');
		const child = spawn(process.execPath, [cli, '--url', `http://127.0.0.1:${server.address().port}`, '--out', out]);
		let stderr = '';
		child.stderr.on('data', (d) => { stderr += d; });
		const code = await new Promise((r) => child.on('close', r));
		assert.notEqual(code, 0);
		assert.match(stderr, /did not return JSON/);
		assert.deepEqual(readdirSync(out), []);
	} finally {
		server.close();
	}
});

test('CLI rejects an option used as the value of another', () => {
	const r = spawnSync(process.execPath, [cli, '--url', '--input', 'x.json'], { encoding: 'utf8' });
	assert.notEqual(r.status, 0);
	assert.match(r.stderr, /Unknown or incomplete option "--url"/);
});

test('OpenAPI documents the 429 rate limit response with Retry-After', () => {
	const api = JSON.parse(buildAll(discover())['openapi/skwirrel-api-v3.openapi.json']);
	const tooMany = api.components.responses.TooManyRequests;
	assert.equal(tooMany.content['application/json'].example.error.code, -32029);
	assert.ok(tooMany.headers['Retry-After']);
	for (const path of Object.values(api.paths)) assert.ok(path.post.responses['429']);
});
