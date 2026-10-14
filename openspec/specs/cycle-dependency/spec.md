# cycle-dependency Specification

## Purpose

Ensures the module dependency graph is acyclic by enforcing layer boundaries: the Q&A orchestration layer must not directly depend on the outbound message delivery layer (WecomClient). Instead, it depends on the `IMessageSender` interface, which WecomClient implements. This prevents circular import issues and enables testability through interface injection.

## Requirements

### Requirement: QaOrchestrator depends on IMessageSender
The system MUST inject the outbound message sender into `QaOrchestrator` via the `IMessageSender` interface token rather than importing `WecomClient` directly. `IMessageSender` MUST expose `sendText(chatId, content, atUser?)` and `sendAsset(chatId, assetId, type)`.

#### Scenario: WecomClient implements IMessageSender
- **WHEN** `WecomModule` provides `IMessageSender` via `useExisting: WecomClient`
- **THEN** any consumer of `IMessageSender` receives the singleton `WecomClient` instance

#### Scenario: QaModule no longer imports WecomModule for class types
- **WHEN** `QaOrchestrator` source file is compiled
- **THEN** the import graph MUST NOT contain `QaOrchestrator → WecomClient` direct class reference

### Requirement: Module dependency graph is acyclic
The system MUST compile a runtime-validatable module dependency graph. The graph MUST NOT contain cycles of any length.

#### Scenario: Module graph cycle detection
- **WHEN** `nest-cli.json` boots the application graph
- **THEN** NestJS MUST initialize without throwing `TypeError: Cannot read properties of undefined` due to circular provider resolution

#### Scenario: Unit test asserts no cycle
- **WHEN** the test suite enumerates provider dependencies from `AppModule.imports`
- **THEN** the depth-first traversal MUST terminate without revisiting any module node
