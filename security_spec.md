# Security Specification & Threat Model for Power Track

## 1. System Invariants & Access Control Policy
1. **Zero Anonymous/Guest Access**: No unauthenticated reading or writing of any collection is allowed.
2. **Mandatory Verified Identity**: Bootstrapped administrator (`kishanlimbani29@gmail.com`) and invited users must have `email_verified == true`.
3. **Pending Approval Gate**: Any self-registered user who is not the bootstrapped admin or a pre-invited email gets status `'pending'` and is forbidden from reading or writing business data until an Admin approves their account.
4. **Append-Only Immutable Ledgers**: `/movements/{movementId}` and `/batches/{batchId}` records are write-once / append-only (`update` and `delete` are strictly `if false;`).
5. **Least Privilege Stock Adjustments**: Fast stock adjustments can only mutate `quantity`, `updatedAt`, and `lastUpdatedBy` on `/items/{itemId}` when possessing `canAdjustStock` capability. Complete item restructuring requires `canEditItems`.
6. **No Self-Privilege Escalation**: Non-admin users cannot elevate their role or change their status from `pending` or `suspended` to `active`.
7. **PII and Profile Protection**: Non-admin users can only read their own user profile document. Full user list is restricted to Admins.
8. **Settings Guarding**: System settings (`/settings/roles_permissions`) are readable by active members but writable only by Admins.

---

## 2. The Dirty Dozen Payloads (Simulated Attack Vectors)

1. **Unauthenticated Read on Items**:
   - `auth: null`, `read /items/item-123` -> `PERMISSION_DENIED`
2. **Unauthenticated Write to Movements**:
   - `auth: null`, `create /movements/m1` -> `PERMISSION_DENIED`
3. **Pending User Reading Inventory**:
   - `auth: { uid: 'user_pending', email: 'pending@test.com' }` where profile has `status: 'pending'`, `read /items/item-123` -> `PERMISSION_DENIED`
4. **Suspended User Reading Inventory**:
   - `auth: { uid: 'user_suspended', email: 'susp@test.com' }` where profile has `status: 'suspended'`, `read /batches/b1` -> `PERMISSION_DENIED`
5. **Self-Escalation to Admin during Signup**:
   - `auth: { uid: 'attacker', email: 'attacker@test.com' }`, `create /users/attacker` with `{ role: 'admin', status: 'active' }` -> `PERMISSION_DENIED`
6. **Unverified Email Impersonation of Owner**:
   - `auth: { uid: 'fake_owner', email: 'kishanlimbani29@gmail.com', token: { email_verified: false } }`, `write /settings/roles_permissions` -> `PERMISSION_DENIED`
7. **Tampering with Immutable Movement Ledger**:
   - `auth: { uid: 'admin_uid', email: 'kishanlimbani29@gmail.com', token: { email_verified: true } }`, `update /movements/mov-1` -> `PERMISSION_DENIED`
8. **Deleting Production Batch Record**:
   - `auth: { uid: 'admin_uid', email: 'kishanlimbani29@gmail.com', token: { email_verified: true } }`, `delete /batches/bat-1` -> `PERMISSION_DENIED`
9. **Unauthorized Stock Quantity Update by Viewer**:
   - `auth: { uid: 'viewer_uid' }` with role `'viewer'` (where `canAdjustStock == false`), `update /items/item-1` -> `PERMISSION_DENIED`
10. **Modifying System Settings as Staff**:
    - `auth: { uid: 'staff_uid' }` with role `'staff'`, `update /settings/roles_permissions` -> `PERMISSION_DENIED`
11. **Malicious ID Poisoning with 2KB Path**:
    - Path: `/items/a_long_path_string_exceeding_128_chars...`, -> `PERMISSION_DENIED`
12. **Public Read on Test Endpoint**:
    - `auth: null`, `read /test/connection` -> `PERMISSION_DENIED`
