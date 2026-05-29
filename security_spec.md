# Security Specifications & Hardened Audit Design

## 1. Data Invariants

1. **User Role Lock**: Once recorded, employees cannot alter their own `role` in the `users` profile collection to prevent privilege escalation.
2. **Authorized Clock-In**: Employees can only create or edit `time_entries` where the `userId` field exactly matches their authenticated User ID (`request.auth.uid`).
3. **Verified Employees ONLY**: Standard creation and update operations for employee documents and logs require that `request.auth.token.email_verified == true`.
4. **Immutable Timestamps**: Logging timestamps such as `clockInTime` and `createdAt` cannot be modified retroactively once submitted, and must match `request.time`.
5. **No Orphaned Entries**: Creates must supply valid identifiers referencing job sites (`jobId`) and valid dates.
6. **Double-Read Guards on Admins**: Admins are verified exclusively as users where the database node `users/$(request.auth.uid).role == 'admin'`, completely ignoring client-supplied headers or claims.

---

## 2. The "Dirty Dozen" Hostile Payloads

The following payloads represent illegal requests crafted to violate security, with expected result `PERMISSION_DENIED`.

### P1: Role Escalation (Identity Spoofing)
*   **Path**: `users/attacker_uid`
*   **Action**: Create or Update
*   **Payload**: `{"uid": "attacker_uid", "email": "attacker@gmail.com", "name": "Attacker", "role": "admin"}` (Attempting to self-assign role)

### P2: Rogue Time Entry Creation for Target User
*   **Path**: `time_entries/rogue_entry`
*   **Action**: Create
*   **Payload**: `{"id": "rogue_entry", "userId": "victim_uid", "employeeName": "Victim", "jobId": "site_1", "jobName": "Vault", "costCode": "Framing", "description": "Stealing hours", "status": "active", "clockInTime": "2026-05-25T19:00:00Z", "clockInCoords": {"latitude": 0, "longitude": 0}, "isManualEdit": false, "isApproved": false, "createdAt": "2026-05-25T19:00:00Z"}`

### P3: Forged Clock-In Timestamps
*   **Path**: `time_entries/my_forged_entry`
*   **Action**: Create
*   **Payload**: `{"id": "my_forged_entry", "userId": "attacker_uid", ... "clockInTime": "2026-01-01T00:00:00Z"}` (Forging custom past time to inflate hours)

### P4: Post-Clockout Multi-Hour Inflation
*   **Path**: `time_entries/existing_entry_id`
*   **Action**: Update
*   **Payload**: `{"clockInTime": "2026-05-24T08:00:00Z", "clockOutTime": "2026-05-24T23:59:00Z"}` (Attempting to extend time length of a past completed slot)

### P5: Unauthorized Job-Site Creation / Hijack
*   **Path**: `jobs/rogue_job_site`
*   **Action**: Create
*   **Payload**: `{"id": "rogue_job_site", "name": "Rogue Site", "address": "Fake Road", "latitude": 0, "longitude": 0, "radius": 1000}` (Non-admin attempting to create a job site)

### P6: System Setting Overwrite
*   **Path**: `settings/general`
*   **Action**: Update
*   **Payload**: `{"autoClockOutTime": "12:00"}` (Non-admin seeking to change the company-wide auto-logout window)

### P7: Bulk-Harvesting Time Entries (Unrestricted List Query)
*   **Path**: `time_entries`
*   **Action**: List
*   **Query**: Standard query without filtering by standard user credentials.

### P8: Rogue Approval of Non-Approved Manual Time Record
*   **Path**: `time_entries/my_manual_sheet`
*   **Action**: Update
*   **Payload**: `{"isApproved": true}` (Non-admin employee attempting to self-approve a manual work entry)

### P9: Self-Assigned Completed Work Deletion
*   **Path**: `time_entries/completed_job_entry`
*   **Action**: Delete
*   **Payload**: Attempting to delete a finalized, completed record to hide a mistake without Manager approval.

### P10: Terminal State Tampering
*   **Path**: `time_entries/approved_record`
*   **Action**: Update
*   **Payload**: Attempting to change an entry that is already marked as approved (`isApproved = true` or `status = "completed"`) after manager review.

### P11: Poison-ID Injection (Denial of Wallet)
*   **Path**: `time_entries/some_extremely_long_junk_string_exceeding_128_chars_designed_to_bloat_indexing`
*   **Action**: Create
*   **Payload**: Standard entry, but utilizing a malicious ID.

### P12: Spying on Colleagues' Private User Profiles
*   **Path**: `users/victim_uid`
*   **Action**: Get
*   **Request**: Non-admin authenticated user trying to read the victim's email address and profile detail without manager clearance.

---

## 3. The Test Runner Reference

A local test suite can verify rules safely inside the standard emulator setup:

```typescript
import { initializeTestEnvironment, RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { setDoc, getDoc, getDocs, collection, query, where } from "firebase/firestore";

let testEnv: RulesTestEnvironment;

describe("Zero-Trust Security Rules Test Suite", () => {
  before(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "time-tracker-mvp",
      firestore: { rules: require("fs").readFileSync("firestore.rules", "utf8") },
    });
  });

  after(async () => {
    await testEnv.cleanup();
  });

  it("should deny self-assigned admin promotions (P1)", async () => {
    const context = testEnv.authenticatedContext("attacker_uid", { email_verified: true });
    const db = context.firestore();
    // Verification should fail
  });
});
```
