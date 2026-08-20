import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { openDb } from '../src/db.js'
import { createLinkedHousehold } from './helpers.js'

let app: FastifyInstance
let cookie: { fold_session: string }
let bridge: Server
let port: number
let accountsServed = 0

const nowUnix = Math.floor(Date.now() / 1000)

/** A miniature SimpleFIN bridge: one claim endpoint, one accounts endpoint. */
function startBridge(): Promise<void> {
  bridge = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/claim/tok123') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end(`http://demo:secret@127.0.0.1:${port}/sfin`)
      return
    }
    if (req.method === 'GET' && req.url?.startsWith('/sfin/accounts')) {
      if (req.headers.authorization !== `Basic ${Buffer.from('demo:secret').toString('base64')}`) {
        res.writeHead(403).end()
        return
      }
      accountsServed += 1
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          errors: [],
          accounts: [
            {
              id: 'ACT-1',
              name: 'Everyday Checking',
              org: { name: 'Demo Bank' },
              balance: '1234.56',
              'balance-date': nowUnix,
              transactions: [
                { id: 'T-1', posted: nowUnix - 86400, amount: '-45.00', description: 'COFFEE SHOP' },
                { id: 'T-2', posted: nowUnix - 2 * 86400, amount: '12.00', description: 'REFUND MERCH' },
                { id: 'T-3', posted: nowUnix, amount: '-99.99', description: 'PENDING THING', pending: true },
              ],
            },
            {
              id: 'ACT-2',
              name: 'Rewards Card',
              org: { name: 'Demo Bank' },
              balance: '-321.00',
              'balance-date': nowUnix,
              transactions: [],
            },
          ],
        }),
      )
      return
    }
    res.writeHead(404).end()
  })
  return new Promise((resolve) => {
    bridge.listen(0, '127.0.0.1', () => {
      port = (bridge.address() as AddressInfo).port
      resolve()
    })
  })
}

async function get(url: string): Promise<any> {
  const res = await app.inject({ method: 'GET', url, cookies: cookie })
  expect(res.statusCode).toBe(200)
  return res.json()
}

beforeAll(async () => {
  await startBridge()
  app = await buildApp({ db: openDb(':memory:'), logger: false })
  const linked = await createLinkedHousehold(app, ['Jake', 'Sam'], 'sfin.dev')
  cookie = linked.cookie
})

afterAll(async () => {
  await app.close()
  bridge.close()
})

describe('SimpleFIN sync', () => {
  it('claims a setup token, auto-creates accounts, and imports posted transactions', async () => {
    const setupToken = Buffer.from(`http://127.0.0.1:${port}/claim/tok123`).toString('base64')
    const connect = (
      await app.inject({ method: 'POST', url: '/api/simplefin/connect', cookies: cookie, payload: { setup_token: setupToken } })
    ).json()
    expect(connect.connected).toBe(true)
    expect(connect.imported).toBe(2) // pending one skipped
    expect(connect.accounts).toBe(2)

    const status = await get('/api/simplefin')
    expect(status.connected).toBe(true)
    expect(status.accounts).toHaveLength(2)
    expect(status.accounts[0].account_name).toContain('Demo Bank')
    expect(status.last_error).toBeNull()

    // The checking account exists with the bridge balance; the card guessed 'credit'
    // and stores what's owed as a positive number.
    const networth = await get('/api/networth')
    const checking = networth.accounts.find((a: { name: string }) => a.name.includes('Everyday'))
    expect(checking).toMatchObject({ type: 'checking', balance_cents: 123456 })
    const card = networth.accounts.find((a: { name: string }) => a.name.includes('Rewards'))
    expect(card).toMatchObject({ type: 'credit', balance_cents: 32100 })

    // Amount signs: -45.00 out → a 4500 expense; +12.00 in → a refund.
    const txs = await get(`/api/transactions?account=${checking.id}`)
    const coffee = txs.transactions.find((t: { description: string }) => t.description === 'COFFEE SHOP')
    const refund = txs.transactions.find((t: { description: string }) => t.description === 'REFUND MERCH')
    expect(coffee.amount_cents).toBe(4500)
    expect(coffee.cleared).toBe(1)
    expect(refund.amount_cents).toBe(-1200)
    // Bare transactions land in the classify queue.
    expect(coffee.lines[0].category_id).toBeNull()

    // It arrived as an undoable batch.
    const batches = await get('/api/import-batches')
    expect(batches.batches.some((b: { filename: string }) => b.filename.includes('SimpleFIN'))).toBe(true)
  })

  it('re-syncing skips everything already imported', async () => {
    const sync = (await app.inject({ method: 'POST', url: '/api/simplefin/sync', cookies: cookie })).json()
    expect(sync.imported).toBe(0)
    expect(sync.skipped).toBe(2)
    expect(accountsServed).toBeGreaterThanOrEqual(2)
  })

  it('refuses a second connect and disconnects cleanly, keeping the data', async () => {
    const setupToken = Buffer.from(`http://127.0.0.1:${port}/claim/tok123`).toString('base64')
    const again = await app.inject({
      method: 'POST',
      url: '/api/simplefin/connect',
      cookies: cookie,
      payload: { setup_token: setupToken },
    })
    expect(again.statusCode).toBe(400)

    await app.inject({ method: 'DELETE', url: '/api/simplefin', cookies: cookie })
    const status = await get('/api/simplefin')
    expect(status.connected).toBe(false)
    // Imported transactions survive the disconnect.
    const networth = await get('/api/networth')
    expect(networth.accounts.length).toBeGreaterThanOrEqual(2)
  })
})
