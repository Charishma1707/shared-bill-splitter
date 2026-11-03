export interface Home {
  id: string
  name: string
  createdAt?: string
  memberCount?: number
}

export interface Member {
  id: string
  homeId: string
  name: string
  orderIndex?: number
}

export interface Share {
  id: string
  billId?: string
  memberId: string
  memberName?: string
  amountCents: number
  paidAt: string | null
  idempotencyKey?: string | null
}

export interface Bill {
  id: string
  homeId: string
  title: string
  totalCents: number
  createdAt: string
  shares: Share[]
}

export interface Balance {
  memberId: string
  name: string
  outstandingCents: number
}

export interface ApiError {
  error: string
}
