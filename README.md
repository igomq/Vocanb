# Vocanb

종이 단어장 사진에서 영어 단어와 인쇄된 한국어 뜻을 추출해, 원하는 범위와 방향으로 테스트하는 개인용 SvelteKit 앱입니다.

## 요구 환경

- Node.js 24 LTS
- pnpm 10.33.0
- Vertex AI가 활성화된 Google Cloud 프로젝트와 Application Default Credentials

## 로컬 실행

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
pnpm hash-password
pnpm dev
```

`pnpm hash-password`는 비밀번호를 화면에 표시하지 않고 읽으며, 출력된 scrypt hash만 `AUTH_PASSWORD_HASH`에 저장합니다. 원문 비밀번호를 명령행 인수나 `.env.example`에 넣지 마세요.

## 환경 변수

- `AUTH_USERNAME`: 로그인 ID
- `AUTH_PASSWORD_HASH`: `pnpm hash-password`가 출력한 scrypt hash
- `SESSION_SECRET`: 임의의 32자 이상 secret
- `GOOGLE_CLOUD_PROJECT`: Vertex AI 프로젝트 ID
- `GOOGLE_CLOUD_LOCATION`: `global` 고정
- `GOOGLE_APPLICATION_CREDENTIALS`: repository 밖의 서비스 계정 JSON 경로
- `GOOGLE_GENAI_USE_VERTEXAI`: `true`
- `VERTEX_MODEL`: `gemini-3.6-flash` 고정
- `DATA_DIR`: 배포와 분리된 영구 데이터 경로
- `ORIGIN`: 외부 HTTPS origin
- `BODY_SIZE_LIMIT`: 업로드 요청 상한(기본 배포값 `50M`)

## 검증과 빌드

```bash
pnpm check
pnpm test
pnpm lint
pnpm build
node build
```

운영 구조와 배포 절차는 [Architecture](docs/ARCHITECTURE.md)와 [Deployment](docs/DEPLOYMENT.md)를 참고하세요.
