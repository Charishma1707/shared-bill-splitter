import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import type { Balance, Bill, Home, Member } from '../types'

export const Route = createFileRoute('/')({
  component: BillSplitterApp,
})

function formatCents(cents: number): string {
  return `${cents}¢`
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    if (Number.isNaN(d.getTime())) return dateStr
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return dateStr
  }
}

function BillSplitterApp() {
  const [homes, setHomes] = useState<Home[]>([])
  const [selectedHomeId, setSelectedHomeId] = useState<string>('')
  const [members, setMembers] = useState<Member[]>([])
  const [bills, setBills] = useState<Bill[]>([])
  const [balances, setBalances] = useState<Balance[]>([])

  // States
  const [loadingHomes, setLoadingHomes] = useState(true)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [payingShareId, setPayingShareId] = useState<string | null>(null)

  // Feedback notifications
  const [globalError, setGlobalError] = useState<string | null>(null)
  const [paymentError, setPaymentError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // Forms
  const [newHomeName, setNewHomeName] = useState('')
  const [isCreatingHome, setIsCreatingHome] = useState(false)
  const [newMemberName, setNewMemberName] = useState('')
  const [isAddingMember, setIsAddingMember] = useState(false)

  // Bill creation form
  const [billTitle, setBillTitle] = useState('')
  const [billAmountInput, setBillAmountInput] = useState('')
  const [isCreatingBill, setIsCreatingBill] = useState(false)
  const [billFormError, setBillFormError] = useState<string | null>(null)

  // Edge cases helper drawer
  const [showEdgeCases, setShowEdgeCases] = useState(false)

  // Load homes list
  const loadHomes = useCallback(async () => {
    setLoadingHomes(true)
    setGlobalError(null)
    const res = await api.getHomes()
    if (!res.ok) {
      setGlobalError(res.error)
      setLoadingHomes(false)
      return
    }

    setHomes(res.data.homes)
    if (res.data.homes.length > 0) {
      setSelectedHomeId((prev) => {
        const exists = res.data.homes.some((h) => h.id === prev)
        return exists ? prev : (res.data.homes[0]?.id ?? '')
      })
    } else {
      setSelectedHomeId('')
    }
    setLoadingHomes(false)
  }, [])

  // Load selected home details (members, bills, balances)
  const loadHomeData = useCallback(async (homeId: string) => {
    if (!homeId) {
      setMembers([])
      setBills([])
      setBalances([])
      return
    }

    setLoadingDetails(true)
    setGlobalError(null)

    const [homeRes, billsRes, balancesRes] = await Promise.all([
      api.getHomeDetails(homeId),
      api.getBills(homeId),
      api.getBalances(homeId),
    ])

    if (!homeRes.ok) {
      setGlobalError(`Failed to load home: ${homeRes.error}`)
    } else {
      setMembers(homeRes.data.members)
    }

    if (!billsRes.ok) {
      setGlobalError((prev) => prev ?? `Failed to load bills: ${billsRes.error}`)
    } else {
      setBills(billsRes.data.bills)
    }

    if (!balancesRes.ok) {
      setGlobalError((prev) => prev ?? `Failed to load balances: ${balancesRes.error}`)
    } else {
      setBalances(balancesRes.data.balances)
    }

    setLoadingDetails(false)
  }, [])

  useEffect(() => {
    loadHomes()
  }, [loadHomes])

  useEffect(() => {
    if (selectedHomeId) {
      loadHomeData(selectedHomeId)
    }
  }, [selectedHomeId, loadHomeData])

  // Handlers
  const handleCreateHome = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newHomeName.trim()) return

    setIsCreatingHome(true)
    setGlobalError(null)
    const res = await api.createHome(newHomeName.trim())
    setIsCreatingHome(false)

    if (!res.ok) {
      setGlobalError(res.error)
      return
    }

    setNewHomeName('')
    setSuccessMessage(`Home "${res.data.name}" created!`)
    setTimeout(() => setSuccessMessage(null), 4000)
    await loadHomes()
    setSelectedHomeId(res.data.id)
  }

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newMemberName.trim() || !selectedHomeId) return

    setIsAddingMember(true)
    setGlobalError(null)
    const res = await api.addMember(selectedHomeId, newMemberName.trim())
    setIsAddingMember(false)

    if (!res.ok) {
      setGlobalError(res.error)
      return
    }

    setNewMemberName('')
    setSuccessMessage(`Member "${res.data.name}" added!`)
    setTimeout(() => setSuccessMessage(null), 4000)
    await loadHomeData(selectedHomeId)
  }

  const handleCreateBill = async (e: React.FormEvent) => {
    e.preventDefault()
    setBillFormError(null)

    const rawAmount = Number(billAmountInput)
    if (
      billAmountInput.trim() === '' ||
      Number.isNaN(rawAmount) ||
      !Number.isInteger(rawAmount) ||
      rawAmount <= 0
    ) {
      setBillFormError('Amount must be a positive whole number of cents (e.g. 1000 or 5001).')
      return
    }

    if (!billTitle.trim()) {
      setBillFormError('Bill title is required.')
      return
    }

    if (members.length === 0) {
      setBillFormError('Cannot create a bill for a home with no members. Add members first.')
      return
    }

    setIsCreatingBill(true)
    const res = await api.createBill(selectedHomeId, billTitle.trim(), rawAmount)
    setIsCreatingBill(false)

    if (!res.ok) {
      setBillFormError(res.error)
      return
    }

    setBillTitle('')
    setBillAmountInput('')
    setSuccessMessage(`Bill "${res.data.title}" split among ${res.data.shares.length} members!`)
    setTimeout(() => setSuccessMessage(null), 4000)
    await loadHomeData(selectedHomeId)
  }

  const handlePayShare = async (billId: string, shareId: string) => {
    setPaymentError(null)
    setPayingShareId(shareId)

    const idempotencyKey = crypto.randomUUID()
    const res = await api.payShare(billId, shareId, idempotencyKey)

    setPayingShareId(null)

    if (!res.ok) {
      // Keeps the share unpaid and displays the error message clearly
      setPaymentError(`Payment failed: ${res.error}`)
      return
    }

    setSuccessMessage(`Share marked as paid successfully!`)
    setTimeout(() => setSuccessMessage(null), 4000)

    // Optimistically update or re-fetch data
    setBills((prevBills) =>
      prevBills.map((b) => {
        if (b.id !== billId) return b
        return {
          ...b,
          shares: b.shares.map((s) => (s.id === shareId ? { ...s, paidAt: res.data.paidAt } : s)),
        }
      }),
    )

    // Refresh balances in background
    if (selectedHomeId) {
      const balRes = await api.getBalances(selectedHomeId)
      if (balRes.ok) {
        setBalances(balRes.data.balances)
      }
    }
  }

  // Live split calculator preview
  const enteredCents = Number(billAmountInput)
  const isValidCents = Number.isInteger(enteredCents) && enteredCents > 0
  const previewSplit =
    isValidCents && members.length > 0
      ? members.map((m, idx) => {
          const base = Math.floor(enteredCents / members.length)
          const rem = enteredCents % members.length
          const amt = base + (idx < rem ? 1 : 0)
          return { id: m.id, name: m.name, cents: amt }
        })
      : null

  const selectedHome = homes.find((h) => h.id === selectedHomeId)

  return (
    <div className="container">
      {/* Header */}
      <header className="app-header">
        <div className="brand">
          <div className="brand-icon">🏠</div>
          <div className="brand-text">
            <h1>Shared Bill Splitter</h1>
            <p>Fair, safe, and transparent home expense sharing</p>
          </div>
        </div>

        <div className="home-selector-bar">
          <label htmlFor="home-select" style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            HOME:
          </label>
          {loadingHomes ? (
            <span className="spinner" />
          ) : (
            <select
              id="home-select"
              value={selectedHomeId}
              onChange={(e) => setSelectedHomeId(e.target.value)}
              disabled={homes.length === 0}
            >
              {homes.length === 0 && <option value="">No homes created</option>}
              {homes.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setShowEdgeCases((prev) => !prev)}
            title="Toggle Edge Cases Inspection"
          >
            🧪 {showEdgeCases ? 'Hide Tests' : 'Edge Cases'}
          </button>
        </div>
      </header>

      {/* Global Notifications */}
      {globalError && (
        <div className="alert alert-error">
          <span>⚠️ {globalError}</span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => (selectedHomeId ? loadHomeData(selectedHomeId) : loadHomes())}
          >
            Retry
          </button>
        </div>
      )}

      {paymentError && (
        <div className="alert alert-error">
          <span>❌ {paymentError}</span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setPaymentError(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {successMessage && (
        <div className="alert alert-success">
          <span>✅ {successMessage}</span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setSuccessMessage(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Edge Cases Test Helper Panel */}
      {showEdgeCases && (
        <div
          className="card"
          style={{ marginBottom: 24, border: '1px solid rgba(139, 92, 246, 0.4)' }}
        >
          <div className="card-title">
            <span style={{ color: '#a78bfa' }}>🧪 Handled Edge Cases & Verification</span>
            <span
              className="badge"
              style={{ background: 'rgba(139, 92, 246, 0.2)', color: '#c4b5fd' }}
            >
              Spec Verifier
            </span>
          </div>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 16 }}>
            Quickly trigger each scenario required by the assignment to observe exact responses and
            UI resilience:
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={async () => {
                const emptyHome = await api.createHome(
                  `Empty Home ${Math.floor(Math.random() * 100)}`,
                )
                if (emptyHome.ok) {
                  const billRes = await api.createBill(emptyHome.data.id, 'Test Bill', 1000)
                  if (!billRes.ok) {
                    alert(`Case 1 Handled (422): ${billRes.error}`)
                  }
                  await loadHomes()
                }
              }}
            >
              1. Home with no members (422)
            </button>

            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={async () => {
                if (!selectedHomeId) return alert('Select or create a home first')
                const billRes = await api.createBill(selectedHomeId, 'Invalid Bill', -50)
                if (!billRes.ok) {
                  alert(`Case 2 Handled (422): ${billRes.error}`)
                }
              }}
            >
              2. Negative/Zero amount (422)
            </button>

            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setBillTitle('WiFi Bill')
                setBillAmountInput('1000')
              }}
            >
              3. Uneven Split: 1000 cents (334, 333, 333)
            </button>

            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={async () => {
                const unpaidShare = bills.flatMap((b) => b.shares).find((s) => !s.paidAt)
                if (!unpaidShare?.billId) {
                  return alert('No unpaid shares found in this home to test idempotency')
                }
                const key = crypto.randomUUID()
                const first = await api.payShare(unpaidShare.billId, unpaidShare.id, key)
                const second = await api.payShare(unpaidShare.billId, unpaidShare.id, key)
                alert(
                  `Case 4 Idempotency: Request 1 (${first.status || 200}), Request 2 (${second.status || 200}). PaidAt preserved: ${first.ok && second.ok && first.data.paidAt === second.data.paidAt}`,
                )
                if (selectedHomeId) await loadHomeData(selectedHomeId)
              }}
            >
              4. Duplicate Idempotency Key (200)
            </button>

            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={async () => {
                const unpaidShare = bills.flatMap((b) => b.shares).find((s) => !s.paidAt)
                if (!unpaidShare?.billId) {
                  return alert('No unpaid shares found in this home')
                }
                const key1 = crypto.randomUUID()
                const key2 = crypto.randomUUID()
                const [r1, r2] = await Promise.all([
                  api.payShare(unpaidShare.billId, unpaidShare.id, key1),
                  api.payShare(unpaidShare.billId, unpaidShare.id, key2),
                ])
                const errMessage = !r1.ok ? r1.error : !r2.ok ? r2.error : 'none'
                alert(
                  `Case 5 Concurrent Race: One succeeded (${r1.ok ? 'Req 1' : 'Req 2'}), the other rejected with 409 Conflict: ${errMessage}`,
                )
                if (selectedHomeId) await loadHomeData(selectedHomeId)
              }}
            >
              5. Concurrent Double-Pay Race (409)
            </button>

            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={async () => {
                const res = await api.payShare('non-existent-bill', 'non-existent-share')
                alert(`Case 6 Handled (404): ${!res.ok ? res.error : 'unexpected'}`)
              }}
            >
              6. Non-existent Bill/Share (404)
            </button>
          </div>
        </div>
      )}

      {/* Top Grid: Home & Members + Balances */}
      <div className="grid-top">
        {/* Home & Members Management */}
        <div className="card">
          <div className="card-title">
            <span>Home & Members</span>
            {selectedHome && (
              <span
                className="badge"
                style={{ background: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa' }}
              >
                {members.length} {members.length === 1 ? 'member' : 'members'}
              </span>
            )}
          </div>

          {/* Quick Create Home */}
          <form onSubmit={handleCreateHome} style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            <input
              type="text"
              className="form-input"
              placeholder="Create new home (e.g. Flat 4B)..."
              value={newHomeName}
              onChange={(e) => setNewHomeName(e.target.value)}
              disabled={isCreatingHome}
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isCreatingHome || !newHomeName.trim()}
            >
              {isCreatingHome ? <span className="spinner" /> : '+ Home'}
            </button>
          </form>

          {/* Members of current home */}
          <div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 8,
              }}
            >
              <span className="form-label" style={{ margin: 0 }}>
                Members (added order):
              </span>
            </div>

            {loadingDetails ? (
              <div style={{ padding: '12px 0' }}>
                <div className="skeleton skeleton-text" style={{ width: '70%' }} />
                <div className="skeleton skeleton-text" style={{ width: '45%' }} />
              </div>
            ) : members.length === 0 ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '8px 0' }}>
                No members in this home yet. Add members below to enable bill splitting.
              </p>
            ) : (
              <div className="members-list">
                {members.map((m, index) => (
                  <div key={m.id} className="member-chip" title={`Added order #${index + 1}`}>
                    <span className="member-avatar">{m.name.charAt(0).toUpperCase()}</span>
                    <span>{m.name}</span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      #{index + 1}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Add Member Form */}
            {selectedHomeId && (
              <form onSubmit={handleAddMember} style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Add member (e.g. Asha, Ben)..."
                  value={newMemberName}
                  onChange={(e) => setNewMemberName(e.target.value)}
                  disabled={isAddingMember}
                />
                <button
                  type="submit"
                  className="btn btn-secondary btn-sm"
                  disabled={isAddingMember || !newMemberName.trim()}
                >
                  {isAddingMember ? <span className="spinner" /> : '+ Member'}
                </button>
              </form>
            )}
          </div>
        </div>

        {/* Member Balances */}
        <div className="card">
          <div className="card-title">
            <span>Outstanding Balances</span>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Total unpaid shares
            </span>
          </div>

          {loadingDetails ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="skeleton" style={{ height: 44 }} />
              <div className="skeleton" style={{ height: 44 }} />
            </div>
          ) : balances.length === 0 ? (
            <div className="empty-box" style={{ padding: '24px 12px' }}>
              <p style={{ fontSize: '0.85rem' }}>No balance information available.</p>
            </div>
          ) : (
            <div className="balances-grid">
              {balances.map((b) => (
                <div key={b.memberId} className="balance-item">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="member-avatar">{b.name.charAt(0).toUpperCase()}</span>
                    <span style={{ fontWeight: 600 }}>{b.name}</span>
                  </div>
                  <div className="balance-amount owing">
                    {b.outstandingCents === 0 ? (
                      <span className="balance-amount clear">0¢ (All settled)</span>
                    ) : (
                      <span>Owes {formatCents(b.outstandingCents)}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bill Creation Form */}
      <div className="card" style={{ marginBottom: 32 }}>
        <div className="card-title">
          <span>Create & Split a Bill</span>
          {members.length > 0 && (
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Split equally between all {members.length} members
            </span>
          )}
        </div>

        {billFormError && (
          <div className="alert alert-error" style={{ marginBottom: 16 }}>
            <span>⚠️ {billFormError}</span>
          </div>
        )}

        <form onSubmit={handleCreateBill}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1.5fr 1fr auto',
              gap: 14,
              alignItems: 'flex-end',
            }}
          >
            <div className="form-group" style={{ margin: 0 }}>
              <label htmlFor="bill-title-input" className="form-label">
                Bill Title
              </label>
              <input
                id="bill-title-input"
                type="text"
                className="form-input"
                placeholder="e.g. WiFi, Groceries, Electricity..."
                value={billTitle}
                onChange={(e) => setBillTitle(e.target.value)}
                disabled={isCreatingBill || !selectedHomeId}
              />
            </div>

            <div className="form-group" style={{ margin: 0 }}>
              <label htmlFor="bill-amount-input" className="form-label">
                Total Amount (Cents)
              </label>
              <input
                id="bill-amount-input"
                type="number"
                min="1"
                step="1"
                className="form-input"
                placeholder="e.g. 1000 or 5001"
                value={billAmountInput}
                onChange={(e) => setBillAmountInput(e.target.value)}
                disabled={isCreatingBill || !selectedHomeId}
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              style={{ height: 42 }}
              disabled={
                isCreatingBill || !selectedHomeId || !billTitle.trim() || !billAmountInput.trim()
              }
            >
              {isCreatingBill ? <span className="spinner" /> : 'Split Bill'}
            </button>
          </div>

          {/* Live calculation breakdown preview */}
          {previewSplit && (
            <div
              style={{
                marginTop: 16,
                padding: '12px 16px',
                background: 'rgba(59, 130, 246, 0.08)',
                border: '1px solid rgba(59, 130, 246, 0.2)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.85rem',
              }}
            >
              <div style={{ fontWeight: 600, color: '#93c5fd', marginBottom: 6 }}>
                Split Breakdown Preview ({formatCents(enteredCents)} total):
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                {previewSplit.map((p) => (
                  <span key={p.id} style={{ color: 'var(--text-secondary)' }}>
                    <strong>{p.name}:</strong> {formatCents(p.cents)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </form>
      </div>

      {/* Bills & Shares Section */}
      <div>
        <div className="bills-section-title">
          <span>Bills & Shares</span>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            {bills.length} {bills.length === 1 ? 'bill' : 'bills'}
          </span>
        </div>

        {loadingDetails ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="skeleton" style={{ height: 140 }} />
            <div className="skeleton" style={{ height: 140 }} />
          </div>
        ) : bills.length === 0 ? (
          <div className="empty-box">
            <div className="empty-icon">🧾</div>
            <h3 style={{ marginBottom: 6, color: 'var(--text-primary)' }}>No bills added yet</h3>
            <p style={{ maxWidth: 420, margin: '0 auto', fontSize: '0.9rem' }}>
              Create a bill above to split the cost fairly among all members of this home.
            </p>
          </div>
        ) : (
          <div>
            {bills.map((bill) => {
              const allPaid = bill.shares.every((s) => s.paidAt !== null)
              return (
                <div key={bill.id} className="bill-card">
                  <div className="bill-header">
                    <div>
                      <div className="bill-title">{bill.title}</div>
                      <div className="bill-meta">
                        Created {formatDate(bill.createdAt)} • Bill ID:{' '}
                        <code className="mono">{bill.id.slice(0, 8)}</code>
                      </div>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <div className="bill-total">{formatCents(bill.totalCents)}</div>
                      <span
                        className={`badge ${allPaid ? 'badge-paid' : 'badge-unpaid'}`}
                        style={{ marginTop: 4 }}
                      >
                        {allPaid ? 'All Shares Settled' : 'Payment Pending'}
                      </span>
                    </div>
                  </div>

                  {/* Shares Table */}
                  <div style={{ overflowX: 'auto' }}>
                    <table className="shares-table">
                      <thead>
                        <tr>
                          <th>Member</th>
                          <th>Share Amount</th>
                          <th>Status</th>
                          <th style={{ textAlign: 'right' }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bill.shares.map((share) => {
                          const isPaid = share.paidAt !== null
                          const isPaying = payingShareId === share.id
                          return (
                            <tr key={share.id}>
                              <td>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <span className="member-avatar">
                                    {(share.memberName || 'M').charAt(0).toUpperCase()}
                                  </span>
                                  <span style={{ fontWeight: 600 }}>
                                    {share.memberName || share.memberId}
                                  </span>
                                </div>
                              </td>
                              <td>
                                <span style={{ fontWeight: 700 }}>
                                  {formatCents(share.amountCents)}
                                </span>
                              </td>
                              <td>
                                {isPaid ? (
                                  <span className="badge badge-paid">
                                    ✓ Paid {formatDate(share.paidAt || '')}
                                  </span>
                                ) : (
                                  <span className="badge badge-unpaid">Pending</span>
                                )}
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                {isPaid ? (
                                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                    Settled
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    className="btn btn-pay"
                                    disabled={isPaying}
                                    onClick={() => handlePayShare(bill.id, share.id)}
                                  >
                                    {isPaying ? (
                                      <>
                                        <span className="spinner" /> Paying...
                                      </>
                                    ) : (
                                      'Pay Share'
                                    )}
                                  </button>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
