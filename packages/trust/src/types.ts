import type { A2HIntent } from '@openthreads/core'

export interface TrustConfig {
  enabled: boolean
  jwsAlgorithm?: string
  privateKeyPath?: string
  publicKeyPath?: string
}

export interface SignedEvidence {
  intent: A2HIntent
  signature: string
  timestamp: Date
  nonce: string
}

export interface TrustLayer {
  config: TrustConfig
  signIntent(intent: A2HIntent): Promise<SignedEvidence>
  verifyEvidence(evidence: SignedEvidence): Promise<boolean>
}
