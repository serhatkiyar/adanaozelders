# Amazon SP-API Incident Response Plan

**Document Version:** 1.0
**Last Reviewed Date:** 2026-09-30
**Next Review Date:** 2027-03-30 (Plan review frequency: at least once every 6 months)
**Incident Owner / Responsible Person:** System Administrator

## 1. Scope
This incident response plan covers all internal systems, scripts, and databases that interact with the Amazon Selling Partner API (SP-API). This includes Amazon Information, SP-API credentials (Client Secret, Refresh Tokens), and catalog/pricing data.

## 2. Mandatory 24-Hour Notification
**CRITICAL:** Any security incident involving Amazon Information will be reported to security@amazon.com within 24 hours of detection.

## 3. Incident Response Roles
- **Incident Owner:** Responsible for overall incident coordination, decision-making, and communication with Amazon.
- **Lead Engineer:** Responsible for technical investigation, containment, and system recovery.

## 4. Incident Response Procedure

### Phase 1: Detection
- Security alerts are generated via server access logs and Fail2ban (which automatically blocks brute-force authentication attempts).
- ClamAV performs daily scheduled malware scans on the application directories.
- Any anomalous activity (e.g., unexpected outbound traffic, unauthorized login attempts) detected during routine checks or daily scans will trigger an immediate investigation.

### Phase 2: Containment
- The affected internal Amazon CLI tool or container will be immediately stopped.
- If a server compromise is suspected, the affected instance will be isolated using UFW (blocking all inbound/outbound traffic except secure SSH).

### Phase 3: Credential Revocation & Investigation
- Amazon SP-API credentials (Refresh Tokens, Client Secrets) and AWS IAM keys will be revoked and rotated immediately via the Seller Central / AWS Management Console.
- System logs, Caddy logs, and Docker container logs will be preserved and analyzed to determine the root cause of the incident.

### Phase 4: Eradication & Recovery
- Malware or compromised configurations will be securely removed based on scan results.
- Systems will be restored from verified off-site backups if necessary.
- Amazon SP-API integration will only be restarted after the vulnerability is patched and verified.

### Phase 5: Post-Incident Review
- A post-incident report will be generated to document what happened and how to prevent future occurrences.
- This policy and related security controls will be updated accordingly.
