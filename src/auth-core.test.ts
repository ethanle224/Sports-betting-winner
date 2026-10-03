import { describe, expect, it } from 'vitest'
import { createSessionToken, verifySessionToken } from '../server/auth-core'

describe('session tokens', () => {
  it('verifies a signed unexpired admin session', () => {
    const token = createSessionToken('Admin', 'test-secret', 1_000)

    expect(verifySessionToken(token, 'test-secret', 1_001)).toEqual('Admin')
  })

  it('rejects altered, expired, and mismatched-secret sessions', () => {
    const token = createSessionToken('Admin', 'test-secret', 1_000)

    expect(verifySessionToken(`${token}x`, 'test-secret', 1_001)).toBeNull()
    expect(verifySessionToken(token, 'other-secret', 1_001)).toBeNull()
    expect(verifySessionToken(token, 'test-secret', 1_000 + 60 * 60 * 1000 + 1)).toBeNull()
  })
})
