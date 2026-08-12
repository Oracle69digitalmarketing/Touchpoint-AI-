/**
 * PHASE 8 — TOUCHPOINT MATRIX ACTION-BUTTON REGRESSION TESTS
 *
 * The existing suite is server-side only (`node --test`), with no frontend
 * test framework, so this uses the same static-source regression technique as
 * phase8-runtime-fixes.test.js. It guards the exact production regression this
 * fix addressed — action buttons that render but have no onClick handler — and
 * the two follow-up guarantees:
 *
 *   - View and Download buttons are wired to real handlers (the rest of the
 *     matrix already shipped them, and On/Off + Delete must stay wired).
 *   - Download reuses the existing client-side QRCode.toDataURL pattern and
 *     the touchpoint's public `/t/:trackingId` URL (no backend endpoint).
 *   - The action container only hides buttons on hover-capable devices, so
 *     actions stay visible on touch devices.
 *
 * Run with: node --test tests/phase8-touchpoint-matrix.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(
  path.join(__dirname, '..', 'components', 'TouchpointMatrix.tsx'),
  'utf8',
);

test('every action button has a functional onClick handler', () => {
  const handlers = {
    view: 'setViewing(tp)',
    download: 'downloadQR(tp)',
    toggle: 'onToggleActive(tp)',
    delete: 'onDelete(tp)',
  };
  for (const [name, handler] of Object.entries(handlers)) {
    assert.ok(
      source.includes(`onClick={() => ${handler}}`),
      `${name} button must keep its onClick handler`,
    );
  }
  const buttons = (source.match(/<button\b/g) || []).length;
  const onClickCount = (source.match(/onClick={/g) || []).length;
  assert.equal(onClickCount, buttons, 'no rendered button is left without an onClick handler');
  assert.equal(buttons, 5, 'four action buttons plus the modal close button');
});

test('Download reuses the client-side QRCode.toDataURL pattern with no backend call', () => {
  assert.ok(source.includes("import QRCode from 'qrcode';"), 'qrcode dependency is imported');
  assert.ok(source.includes('await QRCode.toDataURL(url, {'), 'QR is generated client-side');
  assert.ok(
    source.includes("const url = tp.url || `${window.location.origin}/t/${tp.trackingId}`;"),
    'QR encodes the touchpoint public URL (backend fallback is the /t/:trackingId page)',
  );
  assert.ok(
    source.includes("link.download = `touchpoint-${tp.name.toLowerCase().replace(/\\s+/g, '-')}.png`;"),
    'download filename derives from the touchpoint name',
  );
  assert.ok(!source.includes('/v1/'), 'no new backend asset endpoint is used');
});

test('action visibility stays touch-friendly while retaining hover reveal', () => {
  assert.ok(
    source.includes('[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100'),
    'hover-only opacity reveal uses the hover-capable media query',
  );
  assert.ok(
    !/opacity-0 group-hover:opacity-100/.test(source),
    'the old unconditional hover-only opacity is gone',
  );
});

test('View opens a lightweight detail modal using existing analytics data', () => {
  assert.ok(source.includes('const [viewing, setViewing] = useState<Touchpoint | null>(null);'));
  assert.ok(source.includes('{viewing && ('), 'detail modal is rendered when a row is selected');
  assert.ok(source.includes('viewing.trackingId'), 'modal exposes the tracking id');
  assert.ok(source.includes('viewing.url'), 'modal exposes the public URL');
  assert.ok(
    source.includes("performanceOf(viewing.id)"),
    'modal derives analytics from the existing analyticsService map',
  );
});

test('action buttons keep accessible labels and the modal close stays accessible', () => {
  const labels = [
    'aria-label={`View analytics for ${tp.name}`}',
    'aria-label={`Download QR asset for ${tp.name}`}',
    'aria-label={tp.active ? `Pause touchpoint ${tp.name}` : `Activate touchpoint ${tp.name}`}',
    'aria-label={`Delete touchpoint ${tp.name}`}',
    'aria-label="Close touchpoint details"',
  ];
  for (const label of labels) {
    assert.ok(source.includes(label), `missing accessibility label: ${label}`);
  }
  for (const title of [
    'title="View Analytics"',
    'title="Download Assets"',
    'title="Delete touchpoint"',
    'title={tp.active ? \'Pause touchpoint\' : \'Activate touchpoint\'}',
  ]) {
    assert.ok(source.includes(title), `meaningful title attribute kept: ${title}`);
  }
});
