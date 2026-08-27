# 폰트 자산·라이선스 기록

온중은 런타임 CDN 의존 없이 아래 OFL 글꼴을 `public/fonts`에서 직접 제공합니다. 버전은
2026-08-23에 각 공식 저장소의 최신 릴리스로 확인해 고정했습니다.

| 역할        | 공식 릴리스                                                                             | 사용 범위                             | 프로젝트 파일                                                 | SHA-256                                                            |
| ----------- | --------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------ |
| Display     | [Wanted Sans v1.0.3](https://github.com/wanteddev/wanted-sans/releases/tag/v1.0.3)      | 가변 400–1000, KS X 1001 한글 2,350자 | `public/fonts/wanted-sans/wanted-sans-variable-ksx1001.woff2` | `e9d3c602974d5fba2aa4369349aa1e832455c55bfc793a205a5ca21a0ec054f8` |
| Display     | [Wanted Sans v1.0.3](https://github.com/wanteddev/wanted-sans/releases/tag/v1.0.3)      | 가변 400–1000, 라틴·기본 기호         | `public/fonts/wanted-sans/wanted-sans-variable-latin.woff2`   | `a785fbc798025b7e672b36dd1df2264292b3117d9580d6f3ddf8c6df3ea0ca13` |
| Body        | [Pretendard v1.3.9](https://github.com/orioncactus/pretendard/releases/tag/v1.3.9)      | 가변 45–930 전체                      | `public/fonts/pretendard/pretendard-variable.woff2`           | `9599f12fd42fc0bce1cd50b47a0c022e108d7aa64dd0d1bb0ed44f3282d900b4` |
| Data / Mono | [JetBrains Mono v2.304](https://github.com/JetBrains/JetBrainsMono/releases/tag/v2.304) | Regular 400                           | `public/fonts/jetbrains-mono/jetbrains-mono-regular.woff2`    | `a9cb1cd82332b23a47e3a1239d25d13c86d16c4220695e34b243effa999f45f2` |
| Data / Mono | [JetBrains Mono v2.304](https://github.com/JetBrains/JetBrainsMono/releases/tag/v2.304) | Bold 700                              | `public/fonts/jetbrains-mono/jetbrains-mono-bold.woff2`       | `c503cc5ec5f8b2c7666b7ecda1adf44bd45f2e6579b2eba0fc292150416588a2` |

## 검증·재생성 도구 설치

폰트 검증과 Wanted Sans 재생성은 Python 및
`requirements-fonts.txt`에 고정한 `fonttools==4.63.0`, `brotli==1.2.0`을 사용합니다.
프로젝트 루트에서 전용 가상환경을 만들고 정확한 버전을 설치합니다.

```powershell
python -m venv .venv-fonts
.\.venv-fonts\Scripts\Activate.ps1
python -m pip install --requirement requirements-fonts.txt
```

체크인된 다섯 자산의 SHA-256, family, WOFF2 format, weight/`wght` 축, cmap을
한 번에 검증합니다. 검증기는 머신별 절대 경로나 폰트 원본 위치를 출력하지 않습니다.

```powershell
python scripts\verify-font-assets.py
```

## Wanted Sans 서브셋 재현

서브셋 입력은 공식 v1.0.3의
`packages/wanted-sans/fonts/webfonts/variable/complete/woff2/WantedSansVariable.woff2`이며,
입력 파일 digest는
`4259e7e9a172e634c2cb419d793b84148990316341e910443e5d10965b2c8f16`입니다.
`scripts/subset-wanted-sans.py`가 이 값을 먼저 검증한 뒤 다음 두 파일을 만듭니다.

- 한글: EUC-KR의 KS X 1001 `B0A1–C8FE`를 해독해 얻는 서로 다른 한글 음절 2,350자
- 라틴: Wanted Sans 공식 웹 분할본의 라틴·라틴 확장·기본 문장부호 범위

```powershell
python scripts\subset-wanted-sans.py `
  --input .\WantedSansVariable.woff2 `
  --output-dir .\public\fonts\wanted-sans
python scripts\verify-font-assets.py
```

재생성 스크립트는 실행 전에 설치된 도구 버전과 공식 입력 digest를 확인합니다. 출력 후 검증기를
다시 실행해 위 표의 고정 SHA-256과 메타데이터가 모두 일치하는지 확인합니다.

서브셋 밖의 드문 한글은 CSS 스택의 Pretendard Variable로 대체됩니다.

## 라이선스와 원본

세 글꼴은 SIL Open Font License 1.1로 배포됩니다. 수정하지 않은 공식 라이선스 전문은
다음 경로에 포함했습니다.

- Wanted Sans: `public/fonts/licenses/wanted-sans-ofl.txt`
- Pretendard: `public/fonts/licenses/pretendard-ofl.txt`
- JetBrains Mono: `public/fonts/licenses/jetbrains-mono-ofl.txt`

원본 배포 경로:

- Wanted Sans: `https://github.com/wanteddev/wanted-sans/tree/v1.0.3`
- Pretendard: `https://github.com/orioncactus/pretendard/tree/v1.3.9`
- JetBrains Mono: `https://github.com/JetBrains/JetBrainsMono/tree/v2.304`

## 로딩 정책

- CSS의 모든 `@font-face`는 `font-display: swap`을 사용합니다.
- 첫 화면에 필요한 Wanted Sans 한글·라틴과 Pretendard만 preload합니다.
- JetBrains Mono는 데이터 숫자가 있는 경로에서 브라우저가 필요할 때 가져옵니다. 전역 preload로
  사용하지 않는 화면의 네트워크 비용을 만들지 않습니다.
