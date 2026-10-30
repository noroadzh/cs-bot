# wecom-integration Specification

## Purpose
Lets the adapter service securely receive and send messages to WeCom group chats through the official self-built application API, with proper signature verification, message encryption/decryption, and a 3.5-second passive-response race against active-push delivery.

## Requirements

### Requirement: WeCom callback signature verification
The system MUST verify every callback message from WeCom by validating that `SHA1(sorted(token, timestamp, nonce, encrypt))` equals the `msg_signature` query parameter.

#### Scenario: Valid signature
- **WHEN** WeCom sends a callback with a correctly computed `msg_signature`, `timestamp`, and `nonce`
- **THEN** the system returns HTTP 200 and processes the decrypted message

#### Scenario: Invalid signature
- **WHEN** WeCom sends a callback with a tampered or mismatched `msg_signature`
- **THEN** the system returns HTTP 401 without processing the message and logs `ErrCode.WECOM_SIGN_INVALID`

### Requirement: WeCom message decryption
The system MUST decrypt the `Encrypt` field using AES-CBC with the configured `EncodingAESKey`, parse the XML payload, and verify that the embedded `receiveid` equals the configured `CorpID`.

#### Scenario: Successful decryption
- **WHEN** the encrypted payload decrypts cleanly and `receiveid` matches `CorpID`
- **THEN** the system parses the XML into `InboundMsg` (ToUserName, FromUserName, ChatId, MsgType, Content, MsgId, MediaId, CreateTime)

#### Scenario: receiveid mismatch
- **WHEN** the decrypted `receiveid` does not equal `CorpID`
- **THEN** the system returns HTTP 401 and logs `ErrCode.WECOM_SIGN_INVALID`

### Requirement: URL verification echo
The system MUST respond to the initial WeCom URL verification handshake by returning the `echostr` query parameter as plaintext after signature verification and decryption succeed.

#### Scenario: First-time callback setup
- **WHEN** WeCom sends a verification request with `echostr` present
- **THEN** the system returns the `echostr` value as plaintext with HTTP 200

### Requirement: Passive reply with 3.5s active-push race
The system MUST reply passively within 3.5 seconds by either returning a non-empty XML body if the answer is ready, or returning an empty success body if not. When the answer completes after the passive window, the system MUST push it as an active `appchat/send` message with `client_msg_id` equal to the `traceId` for idempotency.

#### Scenario: Answer ready before 3.5s
- **WHEN** the orchestration pipeline returns an answer within 3.5 seconds of the callback
- **THEN** the system returns the answer as the passive XML reply

#### Scenario ready 3.5s
- **WHEN** the orchestration pipeline takes longer than 3.5 seconds
- **THEN** the system returns an empty success body immediately and pushes the answer via `appchat/send` with `client_msg_id` equal to the `traceId`

### Requirement: access_token caching and distributed refresh

The system MUST cache the WeCom `access_token` in Redis for 7000 seconds and protect token refresh with a `SETNX` lock to prevent concurrent refreshes when multiple adapter instances run. A cached token with fewer than 300 seconds remaining MUST be treated as expired so refreshes happen ahead of the deadline.

#### Scenario: Fresh token request

- **WHEN** the cached `access_token` is present and has more than 300 seconds remaining
- **THEN** the system uses the cached token without contacting WeCom

#### Scenario: Token near expiry refreshes early

- **WHEN** the cached `access_token` has 300 seconds or fewer remaining
- **THEN** the system refreshes the token before using it, instead of sending a request that would fail

#### Scenario: Token refresh under contention

- **WHEN** two adapter instances both detect an expired token simultaneously
- **THEN** only one refreshes via the `SETNX` lock and the other reuses the refreshed token


### Requirement: WecomClient unified outbound interface
The system MUST expose all outbound WeCom API calls through a single `WecomClient` class, providing methods: `sendText(chatId, content, atUser?)`, `sendFile(chatId, mediaId)`, `sendVideo(chatId, mediaId, title)`, `uploadMedia(type, path)`, `downloadMedia(mediaId)`, and `getAccessToken()`.

#### Scenario: Send text with @mention
- **WHEN** `sendText` is called with an `atUser` argument
- **THEN** the request to `appchat/send` includes `atuserlist` containing the user ID and the message appears with an @-badge for that user in the group

#### Scenario: Media download size limit
- **WHEN** `downloadMedia` is called for a media larger than 10 MB
- **THEN** the system rejects the download and returns an error indicating size limit exceeded

### Requirement: Media upload retry once
The system MUST retry a failed `media/upload` call exactly once before returning an error to the caller.

#### Scenario: First upload fails
- **WHEN** the first `media/upload` call returns a non-2xx response or times out
- **THEN** the system retries the upload once; on second failure, returns `ErrCode.ASSET_SEND_FAIL` to the caller
