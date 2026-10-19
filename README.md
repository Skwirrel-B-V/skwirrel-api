# Skwirrel PIM API v3

API documentation and ready-to-use client collections for the [Skwirrel](https://skwirrel.eu) Product Information Management system.

Everything in `openrpc/`, `openapi/`, `postman/` and `bruno/` is **generated** from Skwirrel core's own description of its API (`rpc.discover`). Don't edit those files by hand: change core, then [regenerate](#regenerate).

## The basics

| | |
|---|---|
| Protocol | JSON-RPC 2.0 over HTTPS |
| Endpoint | `POST https://{customer}.skwirrel.eu/jsonrpc` (production) |
| | `POST https://{customer}.skwirrel.dev/jsonrpc` (dev/test) |
| Version header | `X-Skwirrel-Api-Version: 3` |
| Auth (default) | `X-Skwirrel-Api-Token: <your static token>` |
| Auth (alternative) | OAuth2 client credentials, then `Authorization: Bearer <access_token>` |

`{customer}` is your tenant name (the examples use `demo`). Every call goes to the same URL. The method name goes in the request body.

Always send the version header. Without it, core answers with its latest version, which can change under you.

## Getting access

A Skwirrel administrator creates a web service client for you and grants it access **per method**. You get one of:

- **A static token** (default, simplest). Send it in the header `X-Skwirrel-Api-Token` on every call.
- **OAuth2 client credentials** (a client ID and secret). Get an access token first:

  ```bash
  curl -X POST https://demo.skwirrel.eu/oauth2/token \
    -d grant_type=client_credentials \
    -d client_id=YOUR_CLIENT_ID \
    -d client_secret=YOUR_CLIENT_SECRET
  ```

  Send the returned `access_token` as `Authorization: Bearer <access_token>`. It is valid for one hour; then request a new one. You can also send the client ID and secret as HTTP Basic auth instead of form fields.

Errors come back as a JSON-RPC `error` object instead of `result`, with a matching HTTP status:

| Situation | HTTP | `error.code` | `error.message` |
|---|---|---|---|
| Wrong, expired or missing token | 401 | -32001 | `Unauthorized` |
| Your client has no grant for this method | 403 | -32002 | `Method is forbidden` |

```json
{ "jsonrpc": "2.0", "error": { "code": -32001, "message": "Unauthorized", "data": "Failed to authenticate client" }, "id": 1 }
```

Ask your administrator to grant the method if you need it.

## Your first request

```bash
curl -X POST https://demo.skwirrel.eu/jsonrpc \
  -H 'Content-Type: application/json' \
  -H 'X-Skwirrel-Api-Version: 3' \
  -H 'X-Skwirrel-Api-Token: YOUR_TOKEN' \
  -d '{"jsonrpc":"2.0","method":"getProducts","params":{"page":1,"limit":2},"id":1}'
```

```json
{
  "jsonrpc": "2.0",
  "result": {
    "products": [{ "product_id": 1, "internal_product_code": "ART001", "...": "..." }],
    "page": { "number_of_items": 2, "items_per_page": 2, "number_of_pages": 1, "current_page": 1 }
  },
  "id": 1
}
```

## Pick a tool

| Tool | File | How |
|---|---|---|
| **OpenRPC** (the source) | `openrpc/skwirrel-api-v3.openrpc.json` | The native JSON-RPC description. Open it in the [OpenRPC playground](https://playground.open-rpc.org/) or feed it to a code generator. |
| **Swagger / OpenAPI 3.1** | `openapi/skwirrel-api-v3.openapi.json`, `openapi/index.html` | Open `index.html` in a browser (works from disk). Pick a server, click Authorize, and try any method. Each method is listed as `/jsonrpc#<method>`; the part after `#` is never sent. |
| **Postman** | `postman/skwirrel-api-v3.postman_collection.json` + `postman/environments/` | Import the collection and both environments. Pick an environment, set `customer` and `api_token`. For OAuth2: collection > Authorization > OAuth 2.0 (pre-filled), set `client_id` and `client_secret`, click Get New Access Token. |
| **Bruno** | `bruno/skwirrel-api-v3/` | Open the folder as a collection in a recent [Bruno](https://www.usebruno.com/). Pick the Production or Development environment, set `customer` and the secret `api_token`. For OAuth2: collection settings > Auth > OAuth 2.0 (pre-filled), set `client_id` and `client_secret`. |

Every request in Postman and Bruno already sends `X-Skwirrel-Api-Version: 3` and uses the example from core as its body.

## Methods

62 methods, grouped by domain. Full parameters, examples and results are in each tool.

| Domain | Methods |
|---|---|
| **Products** (14) | `getProducts`, `getProductsByFilter`, `checkProductsInSelection`, `saveProduct`, `saveProductTranslation`, `saveProductSeo`, `saveProductLegislation`, `saveProductChangeRequest`, `saveProductCustomGroup`, `saveProductAttachment`, `saveProductCategory`, `saveSimpleProductFeature`, `deleteProduct`, `deleteProductCategory` |
| **Trade items** (8) | `getTradeItems`, `saveTradeItem`, `saveTradeItemTranslation`, `saveTradeItemPrice`, `saveTradeItemVat`, `saveTradeItemCustomGroup`, `saveSimpleTradeItemFeature`, `deleteTradeItem` |
| **Grouped products** (3) | `getGroupedProducts`, `getProductGroups`, `saveGroup` |
| **Categories** (3) | `getCategories`, `saveCategory`, `deleteCategory` |
| **Brands, manufacturers and suppliers** (9) | `getBrands`, `saveBrand`, `deleteBrand`, `getManufacturers`, `saveManufacturer`, `deleteManufacturer`, `getSuppliers`, `saveSupplier`, `deleteSupplier` |
| **Attachments** (3) | `getAttachments`, `saveAttachment`, `saveSimpleAttachmentFeature` |
| **ETIM** (9) | `getEtimReleases`, `getEtimClasses`, `getEtimFeatures`, `getEtimValues`, `getDenormalizedEtimData`, `getMetaClassifications`, `saveEtimClassification`, `saveEtimFeatureValue`, `deleteEtimClassification` |
| **Custom classification** (9) | `getCustomClasses`, `getCustomFeatures`, `getCustomUnits`, `getCustomValues`, `getDenormalizedCustomClassData`, `saveCustomClass`, `saveCustomFeature`, `saveCustomUnit`, `saveCustomValue` |
| **Price lists** (1) | `getPriceLists` |
| **Webhooks** (3) | `getWebHooks`, `saveWebHook`, `deleteWebHook` |

Addons can add their own methods to a tenant. Those are not documented here.

### Propose instead of publish: `add_to_changes`

`saveProduct`, `saveProductTranslation`, `saveTradeItem` and `saveTradeItemTranslation` accept `"add_to_changes": true`. The change is then queued for review in Skwirrel instead of published:

```json
{ "jsonrpc": "2.0", "result": { "product_id": 123, "outcome": "queued_for_review", "change_request_id": 42 }, "id": 1 }
```

Only existing products and trade items can be proposed (pass their ID). Other methods reject `add_to_changes`. `saveProductChangeRequest` is the older name for `saveProduct` with `add_to_changes: true`.

### Still on API v2?

v2 is deprecated. Calls with `X-Skwirrel-Api-Version: 2` still work, but the response carries `X-Skwirrel-Api-Version-Status: deprecated` and `X-Skwirrel-Api-Version-Latest: 3`. Move to v3: send `X-Skwirrel-Api-Version: 3` and check the methods you use against this documentation. Older v2 docs that lived in this repo were removed because they didn't match the API.

## Regenerate

Requires Node 20 or later. No dependencies to install.

```bash
# From a running core (dev stack or a test tenant). No token needed.
npm run generate -- --url https://demo.skwirrel.dev

# Or from a saved discovery document
curl -s -X POST https://demo.skwirrel.dev/jsonrpc \
  -H 'Content-Type: application/json' -H 'X-Skwirrel-Api-Version: 3' \
  -d '{"jsonrpc":"2.0","method":"rpc.discover","id":1}' > discover.json
npm run generate -- --input discover.json

npm test
```

Use a core with **no addons active**: addon methods would end up in the public docs. The generator stops when core serves a method that isn't in `scripts/domains.mjs`, and when a core method is missing. A new core method needs a line there (pick its domain). Nothing is written unless the whole build succeeds, and two runs on the same core give the same files.

`test/fixtures/rpc-discover-v3.json` is the discovery document the tests run against. Refresh it together with the generated files.

## Repository structure

```
├── openrpc/skwirrel-api-v3.openrpc.json       # generated: the source spec
├── openapi/
│   ├── skwirrel-api-v3.openapi.json           # generated: OpenAPI 3.1
│   └── index.html                             # generated: Swagger UI, spec inlined
├── postman/
│   ├── skwirrel-api-v3.postman_collection.json
│   └── environments/                          # production (.eu), development (.dev)
├── bruno/skwirrel-api-v3/                     # generated: one .bru per method
├── scripts/
│   ├── generate.mjs                           # the generator
│   └── domains.mjs                            # method -> domain map (edit by hand)
├── test/                                      # node --test, plus the fixture
└── LICENSE
```

## License

[Apache License 2.0](LICENSE)
