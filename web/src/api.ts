import type { Balance, Bill, Home, Member, Share } from './types'

export class ApiRequestError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
  }
}

async function request<T>(
  url: string,
  options: RequestInit = {},
  timeoutMs = 12000,
): Promise<{ ok: true; data: T; status: number } | { ok: false; error: string; status: number }> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })

    const text = await res.text()
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }

    if (!res.ok) {
      const errorMessage =
        data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
          ? data.error
          : `Server returned status ${res.status}`
      return { ok: false, error: errorMessage, status: res.status }
    }

    return { ok: true, data: data as T, status: res.status }
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return {
        ok: false,
        error: 'Request timed out after waiting for server response',
        status: 408,
      }
    }
    const message = err instanceof Error ? err.message : 'Network error occurred'
    return { ok: false, error: message, status: 0 }
  } finally {
    clearTimeout(timeoutId)
  }
}

export const api = {
  getHomes: () => request<{ homes: Home[] }>('/api/homes'),

  createHome: (name: string) =>
    request<Home>('/api/homes', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  getHomeDetails: (homeId: string) =>
    request<Home & { members: Member[] }>(`/api/homes/${encodeURIComponent(homeId)}`),

  addMember: (homeId: string, name: string) =>
    request<Member>(`/api/homes/${encodeURIComponent(homeId)}/members`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  getBills: (homeId: string) =>
    request<{ bills: Bill[] }>(`/api/homes/${encodeURIComponent(homeId)}/bills`),

  createBill: (homeId: string, title: string, totalCents: number) =>
    request<Bill>(`/api/homes/${encodeURIComponent(homeId)}/bills`, {
      method: 'POST',
      body: JSON.stringify({ title, totalCents }),
    }),

  payShare: (billId: string, shareId: string, idempotencyKey?: string) => {
    const key = idempotencyKey || crypto.randomUUID()
    return request<Share>(
      `/api/bills/${encodeURIComponent(billId)}/shares/${encodeURIComponent(shareId)}/pay`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
      },
    )
  },

  getBalances: (homeId: string) =>
    request<{ balances: Balance[] }>(`/api/homes/${encodeURIComponent(homeId)}/balances`),
}
