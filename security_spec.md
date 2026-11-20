# Firestore Security Specification (Payload-First TDD)

## 1. Data Invariants
1. **Strict Ownership Isolation (PII & Workspace):** A user may read, create, update, or delete only documents under `/users/{userId}` where `userId == request.auth.uid` and `request.auth.token.email_verified == true`.
2. **Parent Existence (Master Gate):** A `projectStates/{projectId}` document cannot be created unless its parent `/users/{userId}` document exists. A `chatMessages/{messageId}` document cannot be created unless its parent `/users/{userId}/projectStates/{projectId}` document exists.
3. **Zero Shadow Fields & Strict Size Guards:** Every write enforces `hasAll` + `hasOnly` on create, `affectedKeys().hasOnly(...)` on update, and `.size() <= MAX` on every string field to block resource exhaustion and shadow-field injection.
4. **Immutable Lineage & Server Timestamps:** `ownerId`, `projectId`, and `createdAt` are strictly immutable after creation; `createdAt == request.time` on create and `updatedAt == request.time` on every write.
5. **No Client-Delegated List Queries:** Every `allow list` explicitly evaluates `resource.data.ownerId == request.auth.uid` without calling `get()` or `exists()`.

## 2. The "Dirty Dozen" Adversarial Payloads (Must Return PERMISSION_DENIED)
1. Unauthenticated read of `/users/u1`
2. Unverified email write to `/users/u1` (`email_verified: false`)
3. Cross-user PII read (`/users/u2` requested by `u1`)
4. Shadow field injection (`isAdmin: true`) on `/users/u1` create
5. Identity spoofing (`ownerId: 'u2'`) on `/users/u1/projectStates/p1`
6. Poisoned oversized document ID (>128 chars or invalid characters) on `projectStates/{badId}`
7. Orphaned `projectStates/p1` creation when `/users/u1` does not exist
8. Client-forged `createdAt` timestamp (not `request.time`)
9. Immutable field mutation (`ownerId` or `createdAt` altered during update)
10. Value poisoning on allowlisted update key (`percent: 999` or `title` > 200 chars)
11. Unbounded text injection (`text` > 8000 chars) in `chatMessages/{m1}`
12. Terminal/chat message mutation attempting to alter `text`, `role`, or `source` after creation
