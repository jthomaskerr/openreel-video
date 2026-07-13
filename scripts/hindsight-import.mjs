#!/usr/bin/env node

import fs from 'node:fs/promises'
import dns from 'node:dns/promises'
import path from 'node:path'

const DEFAULT_API_BASE = 'https://hindsight.techshelter.app/api'
const DEFAULT_BANK = 'coding-assistant'
const DEFAULT_PROJECT_TAG = 'project:atg'
const DEFAULT_BATCH_SIZE = 5
const PROGRESS_WIDTH = 24
const ASYNC_BATCH_THRESHOLD = 2
const POLL_INTERVAL_MS = 2000
const MAX_POLL_ATTEMPTS = 60

function usage() {
  console.error(`Usage:
  hindsight-import.mjs [--bank BANK] [--api URL] [--project-tag TAG] [--batch-size N] [--dry-run] FILE...

Defaults:
  --bank        ${DEFAULT_BANK}
  --api         ${DEFAULT_API_BASE}
  --project-tag ${DEFAULT_PROJECT_TAG}
  --batch-size  ${DEFAULT_BATCH_SIZE}
`)
}

function parseArgs(argv) {
  const options = {
    bank: process.env.HINDSIGHT_BANK_ID ?? DEFAULT_BANK,
    api: process.env.HINDSIGHT_API_BASE ?? process.env.HINDSIGHT_API_URL ?? DEFAULT_API_BASE,
    projectTag: process.env.HINDSIGHT_PROJECT_TAG ?? DEFAULT_PROJECT_TAG,
    batchSize: Number(process.env.HINDSIGHT_BATCH_SIZE ?? DEFAULT_BATCH_SIZE),
    token: process.env.HINDSIGHT_API_TOKEN ?? process.env.HINDSIGHT_TOKEN ?? '',
    dryRun: false,
    files: [],
    apiSource: process.env.HINDSIGHT_API_BASE || process.env.HINDSIGHT_API_URL ? 'env' : 'default',
    bankSource: process.env.HINDSIGHT_BANK_ID ? 'env' : 'default',
    projectTagSource: process.env.HINDSIGHT_PROJECT_TAG ? 'env' : 'default',
    batchSizeSource: process.env.HINDSIGHT_BATCH_SIZE ? 'env' : 'default',
  }

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--bank') {
      options.bank = argv[++i]
      options.bankSource = 'cli'
      continue
    }
    if (arg === '--api') {
      options.api = argv[++i]
      options.apiSource = 'cli'
      continue
    }
    if (arg === '--project-tag') {
      options.projectTag = argv[++i]
      options.projectTagSource = 'cli'
      continue
    }
    if (arg === '--batch-size') {
      options.batchSize = Number(argv[++i])
      options.batchSizeSource = 'cli'
      continue
    }
    if (arg === '--dry-run') {
      options.dryRun = true
      continue
    }
    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }
    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`)
    }
    options.files.push(arg)
  }

  return options
}

function slugifyDocumentId(filePath) {
  const withoutExt = filePath.replace(/\.[^.\\/]+$/, '')
  return withoutExt
    .replace(/[\\/]+/g, '__')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function chunk(items, size) {
  const batches = []
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size))
  }
  return batches
}

function extractDocumentTextLength(doc) {
  if (typeof doc?.text_length === 'number') {
    return doc.text_length
  }
  if (typeof doc?.original_text === 'string') {
    return doc.original_text.length
  }
  return 0
}

async function fetchAllDocuments({ endpoint, token }) {
  const documents = []
  const limit = 100
  for (let offset = 0; ; offset += limit) {
    const url = new URL(endpoint)
    url.pathname = url.pathname.replace(/\/memories$/, '/documents')
    url.searchParams.set('limit', String(limit))
    url.searchParams.set('offset', String(offset))

    const response = await fetch(url, {
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(
        [
          `Failed to list existing documents.`,
          `endpoint: ${url.toString()}`,
          `status: ${response.status} ${response.statusText}`,
          `response: ${text}`,
        ].join('\n')
      )
    }

    const payload = await response.json()
    const items = Array.isArray(payload?.items) ? payload.items : []
    documents.push(...items)
    if (documents.length >= Number(payload?.total ?? items.length)) {
      break
    }
    if (items.length === 0) {
      break
    }
  }

  return documents
}

function summarizeExistingDocument(doc) {
  return {
    id: doc.id,
    textLength: extractDocumentTextLength(doc),
  }
}

function describeDuplicateMatch(item, existing) {
  return {
    document_id: item.document_id,
    path: item.metadata?.path ?? item.document_id,
    existing_document_id: existing.id,
    existing_text_length: existing.textLength,
    incoming_text_length: item.content.length,
  }
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForOperation({ endpoint, token, operationId, batchLabel, progress }) {
  const operationsEndpoint = endpoint.replace(/\/memories$/, `/operations/${encodeURIComponent(operationId)}`)

  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt += 1) {
    const url = new URL(operationsEndpoint)
    url.searchParams.set('include_payload', 'false')
    const response = await fetch(url, {
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(
        [
          `Failed to poll operation ${operationId}.`,
          `endpoint: ${url.toString()}`,
          `status: ${response.status} ${response.statusText}`,
          `response: ${text}`,
        ].join('\n')
      )
    }

    const payload = await response.json()
    const status = payload?.status ?? 'not_found'
    if (status === 'completed') {
      progress.update(progress.current, `${batchLabel} done`)
      return payload
    }
    if (status === 'failed' || status === 'cancelled' || status === 'not_found') {
      throw new Error(
        [
          `Async retain operation ${operationId} ${status}.`,
          `batch: ${batchLabel}`,
          `error: ${payload?.error_message ?? 'unknown'}`,
        ].join('\n')
      )
    }

    progress.update(progress.current, `${batchLabel} (${status})`)
    if (attempt < MAX_POLL_ATTEMPTS) {
      await sleep(POLL_INTERVAL_MS)
    }
  }

  throw new Error(`Timed out waiting for async retain operation ${operationId} after ${MAX_POLL_ATTEMPTS} attempts.`)
}

function formatProgress(current, total, label) {
  const safeTotal = Math.max(total, 1)
  const ratio = Math.min(Math.max(current / safeTotal, 0), 1)
  const filled = Math.round(ratio * PROGRESS_WIDTH)
  const empty = PROGRESS_WIDTH - filled
  const percent = Math.round(ratio * 100)
  return `${label} [${'█'.repeat(filled)}${'░'.repeat(empty)}] ${percent}% (${current}/${total})`
}

function createProgressReporter(totalItems) {
  const isInteractive = Boolean(process.stderr.isTTY)
  let lastLineLength = 0
  const state = { current: 0 }

  const writeLine = (line) => {
    if (!isInteractive) {
      process.stderr.write(`${line}\n`)
      return
    }
    const padded = line.padEnd(lastLineLength, ' ')
    process.stderr.write(`\r${padded}`)
    lastLineLength = Math.max(lastLineLength, line.length)
  }

  const done = () => {
    if (isInteractive) {
      process.stderr.write('\n')
    }
  }

  return {
    start() {
      writeLine(formatProgress(0, totalItems, 'Importing'))
    },
    update(current, label = 'Importing') {
      state.current = current
      writeLine(formatProgress(current, totalItems, label))
    },
    finish() {
      writeLine(formatProgress(totalItems, totalItems, 'Imported'))
      done()
    },
    fail() {
      if (isInteractive) {
        process.stderr.write('\n')
      }
    },
    get current() {
      return state.current
    },
  }
}

async function main() {
  let options
  try {
    options = parseArgs(process.argv)
  } catch (error) {
    console.error(String(error.message || error))
    usage()
    process.exit(1)
  }

  if (options.help || options.files.length === 0) {
    usage()
    process.exit(options.help ? 0 : 1)
  }

  if (!Number.isInteger(options.batchSize) || options.batchSize < 1) {
    throw new Error(`Invalid batch size: ${options.batchSize}`)
  }

  const cwd = process.cwd()
  const items = []
  const fileSummaries = []

  for (const file of options.files) {
    const resolved = path.resolve(cwd, file)
    const content = await fs.readFile(resolved, 'utf8')
    const relativePath = path.relative(cwd, resolved)
    const documentId = slugifyDocumentId(relativePath)
    fileSummaries.push({
      path: relativePath,
      document_id: documentId,
      textLength: content.length,
    })
    items.push({
      content,
      context: 'project',
      document_id: documentId,
      metadata: {
        source: 'filesystem',
        path: relativePath,
      },
      tags: [options.projectTag],
    })
  }

  if (options.dryRun) {
    console.log(JSON.stringify({ bank: options.bank, bankSource: options.bankSource, api: options.api, apiSource: options.apiSource, projectTag: options.projectTag, projectTagSource: options.projectTagSource, batchSize: options.batchSize, batchSizeSource: options.batchSizeSource, hasToken: Boolean(options.token), items, fileSummaries, skippedItems: [] }, null, 2))
    return
  }

  const normalizedApi = options.api.replace(/\/+$/, '').replace(/\/api$/, '')
  const endpoint = `${normalizedApi}/v1/default/banks/${encodeURIComponent(options.bank)}/memories`
  const apiHost = new URL(normalizedApi).hostname

  try {
    await dns.lookup(apiHost)
  } catch (error) {
    throw new Error(
      [
        `Cannot resolve Hindsight host: ${apiHost}`,
        `api: ${normalizedApi}`,
        `bank: ${options.bank}`,
        `hint: the host may be wrong for this environment; try --api https://hindsight.techshelter.app/api`,
        `underlying error: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`,
      ].join('\n'),
      { cause: error }
    )
  }

  const existingDocuments = await fetchAllDocuments({ endpoint, token: options.token })
  const existingById = new Map(
    existingDocuments.map((doc) => [doc.id, summarizeExistingDocument(doc)])
  )

  const dedupedItems = []
  const skipped = []
  for (const item of items) {
    const existing = existingById.get(item.document_id)
    if (existing && existing.textLength === item.content.length) {
      skipped.push(describeDuplicateMatch(item, existing))
      continue
    }
    dedupedItems.push(item)
  }

  const batches = chunk(dedupedItems, options.batchSize)
  const results = []
  const progress = createProgressReporter(dedupedItems.length)
  progress.start()

  for (const [index, batch] of batches.entries()) {
    let response
    const batchLabel = `Batch ${index + 1}/${batches.length}`
    try {
      const useAsync = batch.length >= ASYNC_BATCH_THRESHOLD
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        },
        body: JSON.stringify({
          async: useAsync,
          items: batch,
        }),
      })
    } catch (error) {
      const files = batch.map((item) => item.metadata?.path ?? item.document_id).join(', ')
      const cause = error instanceof Error ? error.cause : undefined
      throw new Error(
        [
          `Hindsight fetch failed for batch ${index + 1}/${batches.length}.`,
          `endpoint: ${endpoint}`,
          `bank: ${options.bank}`,
          `files: ${files}`,
          `error: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`,
          cause ? `cause: ${cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)}` : null,
        ]
          .filter(Boolean)
          .join('\n'),
        { cause: error }
      )
    }

    const text = await response.text()
    let payload
    try {
      payload = text ? JSON.parse(text) : null
    } catch {
      payload = text
    }

    if (!response.ok) {
      const files = batch.map((item) => item.metadata?.path ?? item.document_id).join(', ')
      throw new Error(
        [
          `Hindsight retain failed for batch ${index + 1}/${batches.length}.`,
          `endpoint: ${endpoint}`,
          `bank: ${options.bank}`,
          `files: ${files}`,
          `status: ${response.status} ${response.statusText}`,
          `response: ${typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)}`,
        ].join('\n')
      )
    }

    const completedItems = Math.min((index + 1) * options.batchSize, dedupedItems.length)

    if (payload?.operation_id) {
      progress.update(Math.max(completedItems - batch.length, 0), `${batchLabel} queued`)
      const operationResult = await waitForOperation({
        endpoint,
        token: options.token,
        operationId: payload.operation_id,
        batchLabel,
        progress,
      })
      results.push({
        ...payload,
        operationResult,
      })
    } else {
      results.push(payload)
      progress.update(completedItems, batchLabel)
    }
  }

  progress.finish()

  console.log(JSON.stringify({
    bank: options.bank,
    bankSource: options.bankSource,
    api: options.api,
    apiSource: options.apiSource,
    projectTag: options.projectTag,
    projectTagSource: options.projectTagSource,
    batchSize: options.batchSize,
    batchSizeSource: options.batchSizeSource,
    hasToken: Boolean(options.token),
    existingDocuments: existingDocuments.length,
    skipped: skipped.length,
    imported: dedupedItems.length,
    batches: batches.length,
    skippedItems: skipped,
    fileSummaries,
    results,
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exit(1)
})
