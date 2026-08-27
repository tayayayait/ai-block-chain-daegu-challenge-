export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <title>온중 溫證 — 서버 오류</title>
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <style>
      body { font: 15px/1.5 system-ui, -apple-system, sans-serif; background: #fafafa; color: #111; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 1.5rem; }
      .card { max-width: 28rem; width: 100%; text-align: center; padding: 2rem; }
      h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
      p { color: #4b5563; margin: 0 0 1.5rem; }
      .actions { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; }
      a, button { padding: 0.5rem 1rem; border-radius: 0.375rem; font: inherit; cursor: pointer; text-decoration: none; border: 1px solid transparent; }
      .primary { background: #111; color: #fff; }
      .secondary { background: #fff; color: #111; border-color: #d1d5db; }
      .skip-link { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
      .skip-link:focus { position: fixed; top: 1rem; left: 1rem; z-index: 1; width: auto; height: auto; margin: 0; clip: auto; overflow: visible; padding: 0.75rem 1rem; background: #111; color: #fff; }
    </style>
  </head>
  <body>
    <a class="skip-link" href="#main-content">본문으로 건너뛰기</a>
    <main id="main-content" class="card" tabindex="-1">
      <h1>서버에 일시적인 문제가 있습니다</h1>
      <p>잠시 후 다시 시도해 주세요.</p>
      <div class="actions">
        <button type="button" class="primary" onclick="location.reload()">다시 시도</button>
        <a class="secondary" href="/">홈으로 돌아가기</a>
      </div>
    </main>
  </body>
</html>`;
}
