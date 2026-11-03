import { describe, expect, it } from 'vitest'
import { type Balance, call, createBill, createHome, type Share } from './helpers'

describe('hidden edge cases & defensive hardening', () => {
  describe('homes and member input edge cases', () => {
    it('rejects invalid JSON body when creating a home', async () => {
      const res = await call('POST', '/api/homes', {
        headers: { 'content-type': 'application/json' },
      })
      expect(res.status).toBe(400)
    })

    it.each([null, [], 'string body', 123])('rejects non-object body: %j', async (body) => {
      const res = await call('POST', '/api/homes', { body })
      expect(res.status).toBe(400)
    })

    it.each(['', '   ', null, 12345])('rejects invalid home name: %j', async (name) => {
      const res = await call('POST', '/api/homes', { body: { name } })
      expect(res.status).toBe(422)
    })

    it.each(['', '   ', null, 12345])('rejects invalid member name: %j', async (name) => {
      const { homeId } = await createHome([])
      const res = await call('POST', `/api/homes/${homeId}/members`, { body: { name } })
      expect(res.status).toBe(422)
    })

    it('returns empty balances list when a home has no members', async () => {
      const { homeId } = await createHome([])
      const res = await call<{ balances: Balance[] }>('GET', `/api/homes/${homeId}/balances`)
      expect(res.status).toBe(200)
      expect(res.body.balances).toEqual([])
    })

    it('returns zero outstanding balance for members with no bills', async () => {
      const { homeId, members } = await createHome(['Alice', 'Bob', 'Charlie'])
      const res = await call<{ balances: Balance[] }>('GET', `/api/homes/${homeId}/balances`)
      expect(res.status).toBe(200)
      expect(res.body.balances).toEqual([
        { memberId: members[0]?.id, name: 'Alice', outstandingCents: 0 },
        { memberId: members[1]?.id, name: 'Bob', outstandingCents: 0 },
        { memberId: members[2]?.id, name: 'Charlie', outstandingCents: 0 },
      ])
    })
  })

  describe('bill splitting edge cases', () => {
    it.each(['', '   ', null, 123])('rejects invalid bill title: %j', async (title) => {
      const { homeId } = await createHome(['Alice'])
      const res = await call('POST', `/api/homes/${homeId}/bills`, {
        body: { title, totalCents: 1000 },
      })
      expect(res.status).toBe(422)
    })

    it('splits a 1 cent bill correctly when members exceed total cents', async () => {
      const { homeId, members } = await createHome(['Alice', 'Bob', 'Charlie'])
      const bill = await createBill(homeId, 1)

      expect(bill.status).toBe(201)
      expect(bill.body.shares.map((s) => s.memberId)).toEqual(members.map((m) => m.id))
      expect(bill.body.shares.map((s) => s.amountCents)).toEqual([1, 0, 0])
      expect(bill.body.shares.reduce((acc, s) => acc + s.amountCents, 0)).toBe(1)
    })

    it('splits a 2 cent bill correctly across 3 members', async () => {
      const { homeId } = await createHome(['Alice', 'Bob', 'Charlie'])
      const bill = await createBill(homeId, 2)

      expect(bill.status).toBe(201)
      expect(bill.body.shares.map((s) => s.amountCents)).toEqual([1, 1, 0])
      expect(bill.body.shares.reduce((acc, s) => acc + s.amountCents, 0)).toBe(2)
    })
  })

  describe('payment concurrency and idempotency edge cases', () => {
    it('rejects empty or whitespace-only Idempotency-Key header', async () => {
      const { homeId } = await createHome(['Alice'])
      const bill = await createBill(homeId, 500)
      const share = bill.body.shares[0]
      if (!share) throw new Error('share missing')

      const res = await call('POST', `/api/bills/${bill.body.id}/shares/${share.id}/pay`, {
        headers: { 'Idempotency-Key': '   ' },
      })
      expect(res.status).toBe(400)
    })

    it('returns 404 when share exists but belongs to a different bill', async () => {
      const { homeId } = await createHome(['Alice'])
      const billA = await createBill(homeId, 500)
      const billB = await createBill(homeId, 500)

      const shareA = billA.body.shares[0]
      if (!shareA) throw new Error('share missing')

      // Trying to pay shareA under billB
      const res = await call('POST', `/api/bills/${billB.body.id}/shares/${shareA.id}/pay`, {
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      })
      expect(res.status).toBe(404)
    })

    it('rejects reusing the same idempotency key for a different share', async () => {
      const { homeId } = await createHome(['Alice', 'Bob'])
      const bill = await createBill(homeId, 1000)
      const share1 = bill.body.shares[0]
      const share2 = bill.body.shares[1]
      if (!share1 || !share2) throw new Error('shares missing')

      const sharedKey = crypto.randomUUID()

      const pay1 = await call('POST', `/api/bills/${bill.body.id}/shares/${share1.id}/pay`, {
        headers: { 'Idempotency-Key': sharedKey },
      })
      expect(pay1.status).toBe(200)

      const pay2 = await call('POST', `/api/bills/${bill.body.id}/shares/${share2.id}/pay`, {
        headers: { 'Idempotency-Key': sharedKey },
      })
      expect(pay2.status).toBe(409)
    })

    it('replays identical response when the same idempotency key is sent 3 times', async () => {
      const { homeId } = await createHome(['Alice'])
      const bill = await createBill(homeId, 800)
      const share = bill.body.shares[0]
      if (!share) throw new Error('share missing')

      const key = crypto.randomUUID()
      const r1 = await call<Share>('POST', `/api/bills/${bill.body.id}/shares/${share.id}/pay`, {
        headers: { 'Idempotency-Key': key },
      })
      const r2 = await call<Share>('POST', `/api/bills/${bill.body.id}/shares/${share.id}/pay`, {
        headers: { 'Idempotency-Key': key },
      })
      const r3 = await call<Share>('POST', `/api/bills/${bill.body.id}/shares/${share.id}/pay`, {
        headers: { 'Idempotency-Key': key },
      })

      expect(r1.status).toBe(200)
      expect(r2.status).toBe(200)
      expect(r3.status).toBe(200)
      expect(r2.body.paidAt).toBe(r1.body.paidAt)
      expect(r3.body.paidAt).toBe(r1.body.paidAt)
    })

    it('handles concurrent race condition: exactly one succeeds, others get 409', async () => {
      const { homeId } = await createHome(['Alice'])
      const bill = await createBill(homeId, 1000)
      const share = bill.body.shares[0]
      if (!share) throw new Error('share missing')

      const billId = bill.body.id
      const shareId = share.id

      // 4 concurrent requests with different idempotency keys
      const promises = [
        call('POST', `/api/bills/${billId}/shares/${shareId}/pay`, {
          headers: { 'Idempotency-Key': crypto.randomUUID() },
        }),
        call('POST', `/api/bills/${billId}/shares/${shareId}/pay`, {
          headers: { 'Idempotency-Key': crypto.randomUUID() },
        }),
        call('POST', `/api/bills/${billId}/shares/${shareId}/pay`, {
          headers: { 'Idempotency-Key': crypto.randomUUID() },
        }),
        call('POST', `/api/bills/${billId}/shares/${shareId}/pay`, {
          headers: { 'Idempotency-Key': crypto.randomUUID() },
        }),
      ]

      const results = await Promise.all(promises)
      const status200 = results.filter((r) => r.status === 200)
      const status409 = results.filter((r) => r.status === 409)

      expect(status200.length).toBe(1)
      expect(status409.length).toBe(3)
    })
  })
})
