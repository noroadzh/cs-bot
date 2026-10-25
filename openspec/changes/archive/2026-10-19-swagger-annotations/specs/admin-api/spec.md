## ADDED Requirements

### Requirement: Response DTO declarations

The system MUST declare OpenAPI response schemas for every 2xx response on management
endpoints (`/admin/*`, `/healthz`, `/wecom/*`), so that the generated OpenAPI document
exposes the actual return shape rather than empty schemas.

#### Scenario: DTO class with ApiProperty

- **WHEN** a controller method returns a typed object for a 2xx response
- **THEN** a Response DTO class exists under `apps/adapter/src/{common,admin,media}/dto/`
  with every persisted field annotated by `@ApiProperty()`

#### Scenario: Controller declares type on ApiResponse

- **WHEN** a controller method is decorated with `@ApiResponse({ status: 2xx })`
- **THEN** that decoration MUST include either `type:` (pointing to a DTO class) or
  `schema:` (inline schema, allowed only for primitive / callback responses)

#### Scenario: Primitive callback responses

- **WHEN** a controller returns a primitive body (e.g. WeCom callback's plain-text
  `echostr` acknowledgement)
- **THEN** the `@ApiResponse` uses `schema: { type: 'string' }` rather than a DTO class

### Requirement: Swagger contract regression test

The system MUST include a test that fails CI if any controller handler drops its
OpenAPI response declaration or any DTO property loses its `@ApiProperty()` annotation.

#### Scenario: Every handler has ApiOperation

- **WHEN** the test reflects over every controller method in `admin/`, `media/`,
  `wecom/`, `health/`
- **THEN** each method MUST be decorated with `@ApiOperation()`

#### Scenario: Every 2xx response is declared

- **WHEN** the test enumerates `@ApiResponse` metadata on each handler
- **THEN** every status code in the 2xx range MUST carry a `type` or `schema` field

#### Scenario: Referenced DTOs expose their fields

- **WHEN** the test resolves each DTO class referenced by an `@ApiResponse`
- **THEN** the DTO's own properties MUST each carry an `@ApiProperty()` annotation
