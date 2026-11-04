export type Confidence = 'high' | 'medium' | 'low';
export type DomainStatus = 'registered' | 'likely_available' | 'unknown';
export type CheckSource = 'rdap' | 'whois' | 'dns' | 'none';

export interface DomainCheck {
  domain: string;
  status: DomainStatus;
  source: CheckSource;
  confidence: Confidence;
  checkedAt: string;
  reason?: string;
}
