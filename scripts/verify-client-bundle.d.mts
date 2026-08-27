export interface ClientBundleVerificationResult {
  readonly filesScanned: number;
}

export function verifyClientBundle(
  staticDirectory: string,
): Promise<ClientBundleVerificationResult>;
