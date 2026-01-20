# Obsidian Reading Mode Highlighter

Obsidian에서 읽기 모드와 편집 모드 모두에서 텍스트 하이라이트를 지원하는 플러그인. 위치 인식 기반으로 동일한 텍스트가 여러 개 있어도 정확한 위치에 하이라이트를 적용한다.

## 주요 기능

- **위치 인식 하이라이트**: 문서에 같은 텍스트가 여러 번 있어도 선택한 위치만 정확히 하이라이트
- **모드 전환 불필요**: 읽기 모드에서 바로 하이라이트 적용, 깜빡임 없음
- **파일 기반 감지**: 파일 내용을 직접 분석하여 하이라이트 상태 확인
- **LRU 캐시**: 메모리 사용량 제한(최대 500개 엔트리)으로 메모리 누수 방지
- **멀티라인 지원**: 여러 줄에 걸친 텍스트 선택도 하이라이트 가능
- **단축키 지원**: 사용자 정의 단축키 설정 가능
- **컨텍스트 메뉴**: 우클릭(데스크톱) 또는 길게 누르기(모바일)로 하이라이트
- **리본 아이콘**: 사이드바에서 빠른 접근
- **크로스 플랫폼**: 데스크톱, 모바일 모두 지원

## 설치

### 수동 설치

1. 이 저장소를 다운로드하거나 클론
2. 플러그인 폴더를 vault의 `.obsidian/plugins/` 디렉토리에 복사:

   ```
   VaultFolder/.obsidian/plugins/obsidian-reading-mode-highlighter/
   ```

3. 다음 파일이 있는지 확인:
   - `main.js`
   - `manifest.json`
   - `styles.css` (해당되는 경우)
4. Obsidian 재시작
5. 설정 → 커뮤니티 플러그인에서 활성화

### 개발 환경 설정

```bash
git clone [repository-url]
cd obsidian-reading-mode-highlighter
npm install
npm run build
```

## 사용법

### 기본 사용

1. **읽기 모드**: 텍스트 선택 후 하이라이터 아이콘 클릭 또는 단축키 사용
2. **편집 모드**: 텍스트 선택 후 동일한 방법으로 하이라이트 적용
3. **컨텍스트 메뉴**: 텍스트 선택 후 우클릭(데스크톱) 또는 길게 누르기(모바일)
4. **토글**: 이미 하이라이트된 텍스트에 다시 적용하면 제거

### 단축키 설정

1. 설정 → 단축키
2. "Reading Mode Highlighter" 검색
3. "Toggle highlight on selected text" 옆의 + 버튼 클릭
4. 원하는 키 조합 지정

### 디버그 모드

플러그인에서 제공하는 커맨드:

- `Toggle debug mode`: 콘솔 로그 출력 on/off
- `Show performance metrics`: 캐시 히트율, 평균 처리 시간 등 확인

## 기술 구조

### 핵심 클래스

```
LRUCache            - 크기 제한이 있는 LRU 캐시 구현
RegexCache          - 정규식 캐싱 (Flyweight 패턴)
ContextProcessor    - 선택 텍스트 주변 문맥 처리 (Memoization)
HighlightDetector   - 파일 기반 하이라이트 상태 감지
```

### 동작 방식

**읽기 모드:**
1. 사용자가 텍스트 선택
2. 선택 위치 주변 문맥(context) 추출
3. 파일 내용 읽기
4. 3단계 매칭 전략으로 정확한 위치 찾기:
   - 문맥 기반 매칭 (1순위)
   - 라인 기반 매칭 (2순위)
   - 전역 매칭 (3순위, 단일 인스턴스일 때만)
5. `==텍스트==` 마커 추가/제거
6. 파일 저장 및 렌더링

**편집 모드:**
- 단일/멀티라인 선택 모두 지원
- 마커 존재 여부 확인 후 토글

### 캐시 시스템

- **LRU 방식**: 오래된 항목부터 자동 제거 (최대 500개)
- **파일 경로 포함**: 캐시 키에 파일 경로를 포함하여 파일 간 오염 방지
- **5분 주기 정리**: 주기적으로 캐시 전체 클리어
- **lastIndex 초기화**: 정규식 상태 오염 방지

## 호환성

- **Obsidian 버전**: v0.15.0 이상
- **플랫폼**: 데스크톱, 모바일
- **테마**: 모든 테마와 호환
- **플러그인 충돌**: 알려진 충돌 없음

## 빌드

```bash
npm run dev      # 개발 빌드 (watch 모드)
npm run build    # 프로덕션 빌드
```

## 문제 해결

### 일반적인 문제

1. **하이라이트가 안 됨**: 텍스트 선택이 명확한지 확인
2. **잘못된 위치에 하이라이트**: 동일 텍스트가 여러 개면 문맥 기반 매칭 사용
3. **"File was modified" 오류**: 다른 프로세스가 파일을 수정함, 다시 시도

### 디버그 로그

`Toggle debug mode` 커맨드로 활성화:

```
[ReadingModeHighlighter] Selected: "텍스트"
[ReadingModeHighlighter] File-based highlight status: false/true
```

## Changelog

### Version 1.3.0

**버그 수정:**
- 정규식 캐시 상태 오염 문제 수정 (lastIndex 초기화)
- 파일 간 캐시 오염 문제 수정 (캐시 키에 파일 경로 포함)
- 파일 수정 race condition 방지 (타임스탬프 검증)
- String.replace()의 $ 특수문자 해석 문제 수정
- 라인 번호 유효성 검증 추가
- 다중 인스턴스 판단 로직 개선

**새 기능:**
- 컨텍스트 메뉴 지원 (우클릭/길게 누르기)
- LRU 캐시 구현 (메모리 누수 방지)
- 멀티라인 선택 지원
- 적응형 context 길이 (선택 길이에 따라 20-150자)
- 워드 바운더리 기반 context 추출
- 디버그 모드 토글 커맨드
- 성능 메트릭 확인 커맨드
- 공백만 선택 시 명확한 에러 메시지

**개선:**
- 캐시 히트율 추적 구현
- 조건부 콘솔 로깅
- Null 체크 강화

### Version 1.2.0

- 위치 인식 하이라이트 시스템 구현
- 파일 기반 하이라이트 감지 추가
- 캐싱을 통한 성능 최적화
- 다중 인스턴스 텍스트 하이라이트 버그 수정

## 기여

1. 저장소 포크
2. 기능 브랜치 생성
3. 변경사항 구현 및 테스트
4. 상세한 설명과 함께 PR 제출

## 라이선스

Copyright (C) 2020-2025 by Dynalist Inc.

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

## Author

Created by [13byte](https://github.com/13byte)
