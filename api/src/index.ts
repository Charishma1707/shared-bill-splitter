import { Hono } from 'hono'

interface EnvWithDB extends Env {
  DB: D1Database
}

const app = new Hono<{ Bindings: EnvWithDB }>()

app.onError((err, c) => {
  console.error('Server error:', err)
  return c.json({ error: err.message || 'Internal server error' }, 500)
})

app.get('/api/health', (c) => c.json({ status: 'ok' }))

// Homes
app.get('/api/homes', async (c) => {
  const homes = await c.env.DB.prepare(
    `SELECT h.id, h.name, h.created_at as createdAt, COUNT(m.id) as memberCount
     FROM homes h
     LEFT JOIN members m ON m.home_id = h.id
     GROUP BY h.id, h.name, h.created_at
     ORDER BY h.created_at DESC`,
  ).all<{ id: string; name: string; createdAt: string; memberCount: number }>()

  return c.json({ homes: homes.results })
})

app.post('/api/homes', async (c) => {
  let body: { name?: unknown } | null = null
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (typeof body.name !== 'string' || body.name.trim() === '') {
    return c.json({ error: 'Name is required' }, 422)
  }

  const name = body.name.trim()
  const id = crypto.randomUUID()

  await c.env.DB.prepare('INSERT INTO homes (id, name) VALUES (?, ?)').bind(id, name).run()

  return c.json({ id, name }, 201)
})

app.get('/api/homes/:homeId', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare(
    'SELECT id, name, created_at as createdAt FROM homes WHERE id = ?',
  )
    .bind(homeId)
    .first<{ id: string; name: string; createdAt: string }>()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const members = await c.env.DB.prepare(
    'SELECT id, home_id as homeId, name, order_index as orderIndex FROM members WHERE home_id = ? ORDER BY order_index ASC',
  )
    .bind(homeId)
    .all<{ id: string; homeId: string; name: string; orderIndex: number }>()

  return c.json({ ...home, members: members.results })
})

// Members
app.post('/api/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  let body: { name?: unknown } | null = null
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (typeof body.name !== 'string' || body.name.trim() === '') {
    return c.json({ error: 'Name is required' }, 422)
  }

  const name = body.name.trim()
  const maxOrder = await c.env.DB.prepare(
    'SELECT COALESCE(MAX(order_index), 0) AS max_idx FROM members WHERE home_id = ?',
  )
    .bind(homeId)
    .first<{ max_idx: number }>()

  const orderIndex = (maxOrder?.max_idx ?? 0) + 1
  const id = crypto.randomUUID()

  try {
    await c.env.DB.prepare(
      'INSERT INTO members (id, home_id, name, order_index) VALUES (?, ?, ?, ?)',
    )
      .bind(id, homeId, name, orderIndex)
      .run()
  } catch {
    // If a concurrent insert occurred, calculate latest next index and insert
    const latestMax = await c.env.DB.prepare(
      'SELECT COALESCE(MAX(order_index), 0) AS max_idx FROM members WHERE home_id = ?',
    )
      .bind(homeId)
      .first<{ max_idx: number }>()
    const retryIndex = (latestMax?.max_idx ?? 0) + 1
    await c.env.DB.prepare(
      'INSERT INTO members (id, home_id, name, order_index) VALUES (?, ?, ?, ?)',
    )
      .bind(id, homeId, name, retryIndex)
      .run()
  }

  return c.json({ id, homeId, name }, 201)
})

// Bills
app.get('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const billsQuery = await c.env.DB.prepare(
    'SELECT id, home_id as homeId, title, total_cents as totalCents, created_at as createdAt FROM bills WHERE home_id = ? ORDER BY created_at DESC',
  )
    .bind(homeId)
    .all<{ id: string; homeId: string; title: string; totalCents: number; createdAt: string }>()

  const sharesQuery = await c.env.DB.prepare(
    `SELECT s.id, s.bill_id as billId, s.member_id as memberId, m.name as memberName, s.amount_cents as amountCents, s.paid_at as paidAt, s.idempotency_key as idempotencyKey
     FROM shares s
     JOIN bills b ON s.bill_id = b.id
     JOIN members m ON s.member_id = m.id
     WHERE b.home_id = ?
     ORDER BY m.order_index ASC`,
  )
    .bind(homeId)
    .all<{
      id: string
      billId: string
      memberId: string
      memberName: string
      amountCents: number
      paidAt: string | null
      idempotencyKey: string | null
    }>()

  const sharesByBill = new Map<string, typeof sharesQuery.results>()
  for (const share of sharesQuery.results) {
    const list = sharesByBill.get(share.billId) ?? []
    list.push(share)
    sharesByBill.set(share.billId, list)
  }

  const bills = billsQuery.results.map((bill) => ({
    ...bill,
    shares: sharesByBill.get(bill.id) ?? [],
  }))

  return c.json({ bills })
})

app.post('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  let body: { title?: unknown; totalCents?: unknown } | null = null
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const { title, totalCents } = body

  if (
    typeof totalCents !== 'number' ||
    !Number.isInteger(totalCents) ||
    totalCents <= 0 ||
    totalCents > Number.MAX_SAFE_INTEGER
  ) {
    return c.json({ error: 'totalCents must be a positive integer' }, 422)
  }

  if (typeof title !== 'string' || title.trim() === '') {
    return c.json({ error: 'Title is required' }, 422)
  }

  const membersResult = await c.env.DB.prepare(
    'SELECT id, name FROM members WHERE home_id = ? ORDER BY order_index ASC',
  )
    .bind(homeId)
    .all<{ id: string; name: string }>()

  const members = membersResult.results
  if (!members || members.length === 0) {
    return c.json({ error: 'Home has no members' }, 422)
  }

  const memberCount = members.length
  const baseShare = Math.floor(totalCents / memberCount)
  const remainder = totalCents % memberCount

  const billId = crypto.randomUUID()
  const shares = members.map((member, index) => {
    const extra = index < remainder ? 1 : 0
    return {
      id: crypto.randomUUID(),
      memberId: member.id,
      amountCents: baseShare + extra,
      paidAt: null as string | null,
    }
  })

  const statements = [
    c.env.DB.prepare(
      'INSERT INTO bills (id, home_id, title, total_cents) VALUES (?, ?, ?, ?)',
    ).bind(billId, homeId, title.trim(), totalCents),
    ...shares.map((share) =>
      c.env.DB.prepare(
        'INSERT INTO shares (id, bill_id, member_id, amount_cents, paid_at) VALUES (?, ?, ?, ?, NULL)',
      ).bind(share.id, billId, share.memberId, share.amountCents),
    ),
  ]

  await c.env.DB.batch(statements)

  return c.json(
    {
      id: billId,
      homeId,
      title: title.trim(),
      totalCents,
      shares,
    },
    201,
  )
})

// Pay a share
app.post('/api/bills/:billId/shares/:shareId/pay', async (c) => {
  const billId = c.req.param('billId')
  const shareId = c.req.param('shareId')

  const idempotencyKey = c.req.header('Idempotency-Key')
  if (!idempotencyKey || idempotencyKey.trim() === '') {
    return c.json({ error: 'Idempotency-Key header is required' }, 400)
  }

  const cleanKey = idempotencyKey.trim()

  const bill = await c.env.DB.prepare('SELECT id FROM bills WHERE id = ?').bind(billId).first()
  if (!bill) {
    return c.json({ error: 'Bill not found' }, 404)
  }

  const share = await c.env.DB.prepare(
    'SELECT id, bill_id, member_id, amount_cents, paid_at, idempotency_key FROM shares WHERE id = ? AND bill_id = ?',
  )
    .bind(shareId, billId)
    .first<{
      id: string
      bill_id: string
      member_id: string
      amount_cents: number
      paid_at: string | null
      idempotency_key: string | null
    }>()

  if (!share) {
    return c.json({ error: 'Share not found' }, 404)
  }

  // If already paid
  if (share.paid_at !== null) {
    if (share.idempotency_key === cleanKey) {
      return c.json(
        {
          id: share.id,
          memberId: share.member_id,
          amountCents: share.amount_cents,
          paidAt: share.paid_at,
        },
        200,
      )
    }
    return c.json({ error: 'Share already paid with a different key' }, 409)
  }

  // Check if idempotency key was already used for a different share
  const existingKeyShare = await c.env.DB.prepare(
    'SELECT id FROM shares WHERE idempotency_key = ? AND id != ?',
  )
    .bind(cleanKey, shareId)
    .first()

  if (existingKeyShare) {
    return c.json({ error: 'Idempotency key already used for another payment' }, 409)
  }

  // Atomic update to mark as paid if not already paid
  const now = new Date().toISOString()
  let result: D1Response
  try {
    result = await c.env.DB.prepare(
      'UPDATE shares SET paid_at = ?, idempotency_key = ? WHERE id = ? AND bill_id = ? AND paid_at IS NULL',
    )
      .bind(now, cleanKey, shareId, billId)
      .run()
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('UNIQUE') || msg.includes('constraint')) {
      return c.json({ error: 'Idempotency key already used for another payment' }, 409)
    }
    throw err
  }

  if (result.meta.changes === 0) {
    // Concurrent update occurred
    const latest = await c.env.DB.prepare(
      'SELECT id, member_id, amount_cents, paid_at, idempotency_key FROM shares WHERE id = ? AND bill_id = ?',
    )
      .bind(shareId, billId)
      .first<{
        id: string
        member_id: string
        amount_cents: number
        paid_at: string | null
        idempotency_key: string | null
      }>()

    if (latest?.paid_at && latest.idempotency_key === cleanKey) {
      return c.json(
        {
          id: latest.id,
          memberId: latest.member_id,
          amountCents: latest.amount_cents,
          paidAt: latest.paid_at,
        },
        200,
      )
    }

    return c.json({ error: 'Share already paid with a different key' }, 409)
  }

  return c.json(
    {
      id: share.id,
      memberId: share.member_id,
      amountCents: share.amount_cents,
      paidAt: now,
    },
    200,
  )
})

// Balances
app.get('/api/homes/:homeId/balances', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const result = await c.env.DB.prepare(
    `SELECT
       m.id AS memberId,
       m.name AS name,
       COALESCE(SUM(
         CASE
           WHEN s.id IS NOT NULL AND b.id IS NOT NULL AND s.paid_at IS NULL THEN s.amount_cents
           ELSE 0
         END
       ), 0) AS outstandingCents
     FROM members m
     LEFT JOIN shares s ON s.member_id = m.id
     LEFT JOIN bills b ON s.bill_id = b.id AND b.home_id = m.home_id
     WHERE m.home_id = ?
     GROUP BY m.id, m.name, m.order_index
     ORDER BY m.order_index ASC`,
  )
    .bind(homeId)
    .all<{ memberId: string; name: string; outstandingCents: number }>()

  return c.json({ balances: result.results }, 200)
})

export default app
