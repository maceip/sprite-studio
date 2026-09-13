import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildMotionPrompt } from '../server/video.ts';

test('buildMotionPrompt synthesizes isometric perspective and 8-direction constraints', () => {
  // Test North direction
  const promptNorth = buildMotionPrompt('walk forward', {
    perspective: 'isometric',
    direction: 'N',
    assetKind: 'character',
    endingType: 'seamless',
  });
  assert.ok(promptNorth.includes('walk forward'));
  assert.ok(promptNorth.includes('isometric 2.5D perspective'));
  assert.ok(promptNorth.includes('North (facing away from camera / rear-angled)'));
  assert.ok(promptNorth.includes('Create a seamless cycle with matching starting and ending poses'));

  // Test South-East direction
  const promptSE = buildMotionPrompt('run', {
    perspective: 'isometric',
    direction: 'SE',
    assetKind: 'character',
    endingType: 'open-ended',
  });
  assert.ok(promptSE.includes('South-East (facing diagonally forward to the right)'));
  assert.ok(promptSE.includes('Perform the animation action naturally through its full movement arc'));

  // Test Side-scroller perspective
  const promptSide = buildMotionPrompt('jump', {
    perspective: 'sidescroller',
    direction: 'E',
    assetKind: 'character',
  });
  assert.ok(promptSide.includes('Fixed 2D side-scroller perspective angle'));
  assert.ok(promptSide.includes('East (facing right)'));
});

test('buildMotionPrompt enforces mechanical rigidity for non-character articulated assets', () => {
  const assetPrompt = buildMotionPrompt('hydraulic crane arm smoothly raises bucket up and down', {
    assetKind: 'asset',
    perspective: 'isometric',
    endingType: 'open-ended',
  });

  // Verify non-character asset rules:
  assert.ok(assetPrompt.includes('MECHANICAL ASSET / OBJECT CONSTRAINTS:'));
  assert.ok(assetPrompt.includes('vehicle chassis, truck body, wheels, base, cabin, and ground anchors must remain 100% COMPLETELY STATIC, RIGID'));
  assert.ok(assetPrompt.includes('ONLY the articulated moving components described in the prompt'));
  assert.ok(assetPrompt.includes('hydraulic boom arm, crane, bucket, hinges, joints'));
  assert.ok(assetPrompt.includes('Strictly preserve hard mechanical edges, textures, colors, and rigid geometry'));
});

test('API supports asset creation, categories, and isometric animation options', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'studio-assets-'));
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    env: { ...process.env, PORT: '0', AI_GAME_STUDIO_HOME: root, OPENROUTER_API_KEY: '', OPENAI_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });

  try {
    const base = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Server startup timed out')), 10000);
      child.stdout.on('data', (chunk) => {
        const match = String(chunk).match(/http:\/\/localhost:(\d+)/);
        if (match) { clearTimeout(timer); resolve(`http://localhost:${match[1]}`); }
      });
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${stderr}`)); });
    });

    let headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const post = (route: string, body: unknown) =>
      fetch(base + route, { method: 'POST', headers, body: JSON.stringify(body) });

    // 1. Create new project
    let res = await post('/api/projects/new', { name: 'city-sim' });
    assert.equal(res.status, 200);
    const view = await res.json();
    headers['X-Project-Name'] = view.name;

    // 2. Create non-character asset (e.g. Bucket Truck)
    res = await post('/api/projects/sprites/new', {
      value: 'bucket-truck',
      kind: 'asset',
      category: 'Vehicles',
    });
    assert.equal(res.status, 200);
    const assetView = await res.json();
    assert.equal(assetView.project.activeSpriteId, 'bucket-truck');
    assert.equal(assetView.kind, 'asset');
    assert.equal(assetView.category, 'Vehicles');
    assert.equal(assetView.project.sprites[0].kind, 'asset');
    assert.equal(assetView.project.sprites[0].category, 'Vehicles');

    headers['X-Sprite-Id'] = 'bucket-truck';

    // 3. Add animation with isometric directional settings and open-ended asset ending
    res = await post('/api/projects/animations/new', { value: 'arm-raise' });
    assert.equal(res.status, 200);
    const animView = await res.json();
    assert.equal(animView.activeAnimationId, 'arm-raise');

    headers['X-Animation-Id'] = 'arm-raise';

    // 4. Save draft with isometric directional metadata
    res = await post('/api/projects/draft', {
      spritePrompt: 'isometric low poly cherry picker bucket truck',
      motionPrompt: 'hydraulic arm smoothly extends upward',
      spriteModel: 'gpt-image-2.5-flare-2026-09-08',
      motionModel: 'sora-2',
      perspective: 'isometric',
      direction: 'NW',
      moveType: 'custom',
      assetKind: 'asset',
      endingType: 'open-ended',
      category: 'Vehicles',
    });
    assert.equal(res.status, 200);
    const draftView = await res.json();
    assert.equal(draftView.perspective, 'isometric');
    assert.equal(draftView.direction, 'NW');
    assert.equal(draftView.assetKind, 'asset');
    assert.equal(draftView.endingType, 'open-ended');

    // 5. Read back manifest to verify persistence
    const manifestRes = await fetch(`${base}/projects/city-sim/sprites/bucket-truck/animations/arm-raise/animation.json`);
    assert.equal(manifestRes.status, 200);
    const manifest = await manifestRes.json();
    assert.equal(manifest.perspective, 'isometric');
    assert.equal(manifest.direction, 'NW');
    assert.equal(manifest.assetKind, 'asset');
    assert.equal(manifest.endingType, 'open-ended');

    // 6. Verify character manifest has kind and category
    const spriteManifestRes = await fetch(`${base}/projects/city-sim/sprites/bucket-truck/sprite.json`);
    assert.equal(spriteManifestRes.status, 200);
    const spriteManifest = await spriteManifestRes.json();
    assert.equal(spriteManifest.kind, 'asset');
    assert.equal(spriteManifest.category, 'Vehicles');

  } finally {
    child.kill();
    await rm(root, { recursive: true, force: true });
  }
});
