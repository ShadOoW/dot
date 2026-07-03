# smoke-entity

Generate and run a void:true smoke test for a given entity.

**Usage:** `/smoke-entity <EntityName>`

Reads the order model JSON and logic `index.ts` files directly — source is source of truth.
Writes `smoke/sm-[entity]-[timestamp].cases.json` then runs `bun cli.ts smoke`.

---

## 0. Setup

Parse `$ARGUMENTS` → `ENTITY` (e.g. `Pool`).

```bash
ls /Users/youneselalami/bruce/sms/server/cli.ts
```

Stop if not found: `STOPPED: project root unreachable`.

Fixed paths for this project:
- `ORDER_MODEL` = `/Users/youneselalami/bruce/doc/order/typescript/code/doc/index.json`
- `EVENT_SRC`   = `/Users/youneselalami/bruce/sms/server/node/code/src/Event`
- `SMOKE_DIR`   = `/Users/youneselalami/bruce/sms/server/smoke`
- `SERVER_DIR`  = `/Users/youneselalami/bruce/sms/server`

---

## 1. Find orders for entity

Read `ORDER_MODEL`. Collect every entry where `ENTITY` appears as a `className` value anywhere in `data.store` (the entity is written by this order).

```bash
python3 -c "
import json, sys
entity = 'ENTITY'
data = json.load(open('/Users/youneselalami/bruce/doc/order/typescript/code/doc/index.json'))
orders = []
for typeId, o in data.items():
    store = o.get('data', {}).get('store', {})
    if any(v.get('className') == entity for v in store.values()):
        orders.append({'typeId': typeId, 'file': o.get('file',''), 'data': o['data']})
print(json.dumps(orders, indent=2))
" 2>&1
```

If no orders found: stop with `STOPPED: no orders write to ENTITY`.

---

## 2. Read payload templates

For each order, derive its `index.ts` path from the `file` field:

`"Identification / Pool / pNHzIF7WIi creates…"` → segments split by ` / ` → first two are family/entity:
`EVENT_SRC/Identification/Pool/pNHzIF7WIi/index.ts`

Read the file if it exists. Extract the JSON body from the `@- << EOF … EOF` curl example — that block is the canonical payload template.

If the file does not exist (entity is new), synthesize a minimal payload from the order schema.

**Distinguish CREATE vs UPDATE** using `data.scope`: if the entity itself appears as a required key in `data.scope`, it is an UPDATE (the object must already exist). Otherwise it is a CREATE.

**CREATE input** — use the `new` key:
```json
{ "input": { "pool": { "new": { "className": "Pool", "name": "smoke-name-TIMESTAMP" } } } }
```

**UPDATE input** — objectId is the **key** (not a field). This is required by `buildStoreToUpdateScopeWithInput` which does `input[entity][objectId]`:
```json
{ "input": { "pool": { "SEED_POOL_ID": { "objectId": "SEED_POOL_ID", "className": "Pool", "managementSettings": {} } } } }
```

**Field value rules for synthesized payloads:**
- String fields → `"smoke-[fieldName]-TIMESTAMP"`
- Object/complex fields (has `subfield` in class model at `doc/class/typescript/code/doc/index.json`) → `{}`
- Array fields → `[]`
- Pointer fields → omit unless required and a SEED is available

**Important**: UPDATE cases (pool-002, pool-003) seed from `db.EntityName.findOne({}, {_id: 1})`. On a fresh DB with no existing entities, this returns null and the seed token stays unresolved — those cases will fail until a real entity exists. Add a comment in the `reason` field noting this dependency.

---

## 3. Seed queries

For each `SEED_CLASSNAME_ID` token across all cases, produce a mongosh eval string.

Rules:
- `Unit` → `db.Unit.findOne({root: true}, {_id: 1})`
- Anything else → `db.ClassName.findOne({}, {_id: 1})`

The CLI runner resolves these at runtime. Do not run them here.

---

## 4. Expected shape

From each order's `data.store.entityKey.field`, collect field names where `required = true`.
These become the `expectedShape` for the case — the runner verifies all required fields are present in `result.data.shape`.

---

## 5. Build cases array

One case per order found in step 1.

```json
{
  "id": "pool-001",
  "orderType": "pNHzIF7WIi",
  "description": "pNHzIF7WIi creates a new pool for a unit",
  "reason": "Verify CREATE happy path for Pool, all required store fields present",
  "void": true,
  "request": {
    "data": {
      "input": { "pool": { "new": { "className": "Pool", "name": "smoke-pool-TIMESTAMP" } } },
      "scope": { "unit": { "SEED_UNIT_ID": { "className": "Unit", "objectId": "SEED_UNIT_ID" } } }
    },
    "meta": { "build": 1 },
    "root": true,
    "type": "pNHzIF7WIi",
    "void": true
  },
  "seedQueries": { "SEED_UNIT_ID": "db.Unit.findOne({root: true}, {_id: 1})" },
  "expectedShape": { "pool": { "required": ["ACL", "managementIds", "managers", "name", "ownership", "parentScopes", "teams", "unit"] } },
  "status": "PENDING",
  "result": null,
  "durationMs": null,
  "error": null
}
```

Use `TIMESTAMP` = Unix timestamp in seconds as a string (same value in all string literals for this run).

---

## 6. Write cases file

```
UID = sm-[entity-lowercase]-[timestamp]
PATH = SMOKE_DIR/UID.cases.json
```

```bash
mkdir -p /Users/youneselalami/bruce/sms/server/smoke
```

Write:

```json
{
  "uid": "sm-pool-1751234567",
  "entity": "Pool",
  "generated": "ISO8601",
  "cases": [ ... ]
}
```

Confirm the file was written.

---

## 7. Run

```bash
cd /Users/youneselalami/bruce/sms/server && bun cli.ts smoke smoke/UID.cases.json
```

Report the output. If any case fails, show the actual response from the written cases file.
