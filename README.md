# Skwirrel PIM API v2

API specification and client collections for the [Skwirrel](https://skwirrel.eu) Product Information Management system.

Skwirrel PIM provides centralized product data management for e-commerce and catalog systems. This repository contains the complete API documentation in multiple formats — no backend source code.

## API overview

- **Protocol:** JSON-RPC 2.0 over HTTP POST
- **Base URL:** `https://{customer}.skwirrel.eu/api/v2/`
- **Authentication:** Token-based (obtain via `getToken`)
- **Multi-tenant:** Per-customer subdomains

### Request format

```json
{
  "jsonrpc": "2.0",
  "method": "getProducts",
  "params": {
    "token": "your-session-token",
    "limit": 50,
    "offset": 0
  },
  "id": 1
}
```

### Response format

```json
{
  "jsonrpc": "2.0",
  "result": { ... },
  "id": 1
}
```

## Available methods

| Domain | Methods |
|---|---|
| **Authentication** | `getToken` |
| **Products** | `getProducts`, `getProductsByFilter`, `saveProduct`, `saveProductSeo`, `saveSimpleProductFeature`, `saveProductCustomGroup` |
| **Trade Items** | `saveTradeItem`, `saveSimpleTradeItemFeature`, `saveTradeItemCustomGroup` |
| **Categories** | `getCategories` |
| **Suppliers** | `saveSupplier` |
| **Attachments** | `getAttachments`, `getAttachment` |
| **Grouped Products** | `getGroupedProducts`, `saveGroup` |
| **Classifications** | `getMetaClassifications`, `getDenormalizedEtimData` |
| **Price Lists** | `getPriceLists` |

## Key features

- **Multilingual** — Product descriptions, SEO metadata, and custom groups support multiple languages (nl, en, etc.)
- **ETIM classification** — Full support for ETIM product classification data
- **Incremental sync** — Use `modified_since` on `getProducts` to fetch only changed records
- **Pagination** — `offset` and `limit` parameters across list endpoints
- **Flexible includes** — Optionally include trade items, features, attachments, SEO, and more per request
- **Custom groups** — User-defined product groupings with multilingual values

## Documentation formats

### OpenAPI / Swagger

The full API specification lives in `swagger/Skwirrel_API_v2.openapi.json` (OpenAPI 3.0.3). Open `swagger/Skwirrel_API_v2_SwaggerUI.html` in a browser to explore it interactively.

### Bruno

Ready-to-use collection in `bruno/Skwirrel-API-v2/`, organized by domain. Open the folder in [Bruno](https://www.usebruno.com/) to get started. A development environment is included under `environments/`.

### Postman

Import `postman/Skwirrel_API_v2.postman_collection.json` into [Postman](https://www.postman.com/). Collection variables for `base_url`, `username`, `password`, and `token` are pre-configured. The token is automatically stored after calling `getToken`.

## Quick start

1. **Get your credentials** from your Skwirrel account administrator.
2. **Pick a client** — import the Postman collection, open the Bruno folder, or use the Swagger UI.
3. **Configure the environment** — set your customer subdomain, username, and password.
4. **Authenticate:**

```json
{
  "jsonrpc": "2.0",
  "method": "getToken",
  "params": {
    "username": "your_username",
    "password": "your_password"
  },
  "id": 1
}
```

5. **Use the returned token** in all subsequent API calls.

## Repository structure

```
├── swagger/
│   ├── Skwirrel_API_v2.openapi.json    # OpenAPI 3.0.3 specification
│   └── Skwirrel_API_v2_SwaggerUI.html  # Interactive documentation
├── postman/
│   └── Skwirrel_API_v2.postman_collection.json
├── bruno/
│   └── Skwirrel-API-v2/
│       ├── environments/               # Environment configs
│       ├── Authentication/
│       ├── Products/
│       ├── Trade-Items/
│       ├── Categories/
│       ├── Suppliers/
│       ├── Attachments/
│       ├── Grouped-Products/
│       ├── Price-Lists/
│       └── Classifications/
└── LICENSE
```

## License

[Apache License 2.0](LICENSE)
