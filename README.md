# Vocanb

[![CI](https://github.com/igomq/Vocanb/actions/workflows/ci.yml/badge.svg)](https://github.com/igomq/Vocanb/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

종이 단어장 사진에서 영어 단어와 인쇄된 한국어 뜻을 추출하고, 원하는 범위와 방향으로 테스트하는 셀프 호스팅 SvelteKit 앱입니다.

## 주요 기능

- 여러 사진의 영어 단어와 한국어 뜻을 Vertex AI로 추출
- 사진별 추출 목표 개수, 인쇄 순서와 품사 보존
- 영어 → 한국어, 한국어 → 영어 테스트와 학습 결과 필터링
- 단어·사진·테스트 기록을 사용자별 로컬 데이터 디렉터리에 저장
- 이미지 검증·압축, 원자적 JSON 저장, HttpOnly 세션 인증

## 기술 스택

- SvelteKit 2, Svelte 5, TypeScript
- Vertex AI (`gemini-3.6-flash`)
- adapter-node, Sharp, Zod
- Vitest, Playwright, ESLint, Prettier

## 요구 환경

- Node.js 24 LTS
- pnpm 10.33.0
- Vertex AI가 활성화된 Google Cloud 프로젝트와 Application Default Credentials

## 로컬 실행

```bash
git clone https://github.com/igomq/Vocanb.git
cd Vocanb
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
pnpm hash-password
pnpm dev
```

`pnpm hash-password`는 비밀번호를 화면에 표시하지 않고 읽으며, 출력된 scrypt hash만 `AUTH_PASSWORD_HASH`에 저장합니다. 원문 비밀번호를 명령행 인수나 `.env.example`에 넣지 마세요.

개발 서버는 기본적으로 `http://localhost:5173`에서 실행됩니다. Vertex AI 호출에는 별도의 Google Cloud 프로젝트와 자격 증명이 필요하며 사용량에 따라 비용이 발생할 수 있습니다.

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
- `BODY_SIZE_LIMIT`: adapter-node 요청 상한(배포값 `92M`; 앱의 사진 합계 90MiB보다 크게 유지)

## 개발과 검증

```bash
pnpm test:ci
```

개별 명령은 `pnpm test`, `pnpm check`, `pnpm lint`, `pnpm build`, `pnpm test:e2e`입니다. 프로덕션 빌드는 `pnpm build` 후 `node build`로 실행합니다.

## 문서

- [Architecture](docs/ARCHITECTURE.md): 애플리케이션 경계, 저장 구조, 네트워크 구성
- [Deployment](docs/DEPLOYMENT.md): VM, WireGuard, Nginx, systemd 배포 절차

## 기여

이슈에서 변경 목적을 공유한 뒤 브랜치에서 작업하고 PR을 보내 주세요. PR 전에는 `pnpm test:ci`를 실행하고, 자격 증명·실데이터·생성된 런타임 파일은 커밋하지 마세요.

## 라이선스

이 프로젝트는 [MIT License](LICENSE)로 배포됩니다. Copyright (c) 2026 GomQ.
