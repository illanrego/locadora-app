// Adapted from Will's Locadora web, MIT, copyright 2026 Illan Rego. See LICENSE.
import * as THREE from 'three';
import { createVhsCase, createVhsSpine } from './vhs-case.mjs';

const COLUMNS = 10;
const ROWS = 4;
const MAX_TAPES = COLUMNS * ROWS;
const MIN_ZOOM = 0.72;
const MAX_ZOOM = 1.75;
const MAX_SECTION_ZOOM = 0.8;

function canvasTexture(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  draw(context, canvas);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { canvas, texture };
}

function drawSign(context, genre, year, theme, providers, providerImages, loading = false) {
  const { width, height } = context.canvas;
  context.fillStyle = '#e7d8b1';
  context.fillRect(0, 0, width, height);
  context.strokeStyle = theme.trim;
  context.lineWidth = 24;
  context.strokeRect(12, 12, width - 24, height - 24);
  context.fillStyle = theme.sign;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  const title = String(genre).toUpperCase();
  const titleFontSize = title.length > 26 ? 58 : title.length > 18 ? 68 : 92;
  context.font = `900 ${titleFontSize}px Impact, Arial Narrow, sans-serif`;
  context.fillText(title, width / 2, 105);
  const detail = loading ? 'OPENING THE BOXES…' : String(year);
  const visibleProviders = providers.slice(0, 4);
  context.font = '700 32px Courier New, monospace';
  const detailWidth = context.measureText(detail).width;
  const logoWidth = visibleProviders.length ? visibleProviders.length * 48 + 12 : 0;
  const detailX = width / 2 - logoWidth / 2;
  context.fillText(detail, detailX, 196);
  let logoX = detailX + detailWidth / 2 + 20;
  for (const provider of visibleProviders) {
    const image = providerImages.get(provider.id);
    if (image?.complete && image.naturalWidth) context.drawImage(image, logoX, 174, 40, 40);
    else {
      context.fillStyle = theme.sign;
      context.fillRect(logoX, 174, 40, 40);
      context.fillStyle = '#e7d8b1';
      context.font = '900 14px Arial Narrow, sans-serif';
      context.fillText(provider.displayName.slice(0, 3).toUpperCase(), logoX + 20, 194);
      context.font = '700 32px Courier New, monospace';
    }
    logoX += 48;
  }
}

function drawStandMarker(context, stand) {
  const { width, height } = context.canvas;
  context.fillStyle = '#101827';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#9e3634';
  context.fillRect(0, 0, width, 38);
  context.strokeStyle = '#c99a2e';
  context.lineWidth = 10;
  context.strokeRect(5, 5, width - 10, height - 10);
  context.fillStyle = '#e7d8b1';
  context.textAlign = 'center';
  context.font = '900 26px Courier New, monospace';
  context.fillText('STAND', width / 2, 31);
  context.fillStyle = '#c99a2e';
  context.font = '900 78px Impact, Arial Narrow, sans-serif';
  context.fillText(String(stand + 1).padStart(2, '0'), width / 2, 126);
}

function featuredMovies(titles) {
  return titles.filter((title) => title.type === 'movie').slice(0, 3);
}

export function createImmersiveShelf({ container, titles = [], genre, year, type, stand = 0, theme, lighting, providers = [], onSelect, onSwipe, onBoundary, plaqueOptions, onConfigure, performanceProfile = 'default', loadFeaturedTitles = async () => titles }) {
  let draft = { genre, year, ignoreStoreYear: Boolean(plaqueOptions?.ignoreStoreYear) };
  let plaqueEditor = null;
  function closePlaqueEditor(save = true) {
    if (!plaqueEditor) return;
    const editor = plaqueEditor;
    if (save && !editor.save()) return;
    plaqueEditor = null;
    editor.element.remove();
    drawPlaque();
  }
  function positionPlaqueEditor() {
    if (!plaqueEditor) return;
    const point = sign.localToWorld(new THREE.Vector3(plaqueEditor.field === 'genre' ? 0 : plaqueEditor.field === 'year' ? -2.23 : .87, plaqueEditor.field === 'genre' ? .33 : -.36, .12)).project(camera);
    const bounds = renderer.domElement.getBoundingClientRect();
    const viewport = window.visualViewport;
    const width = Math.min(plaqueEditor.field === 'genre' ? 310 : 230, (viewport?.width || window.innerWidth) - 16);
    const left = bounds.left + (point.x + 1) * bounds.width / 2 - width / 2;
    const top = bounds.top + (1 - point.y) * bounds.height / 2 - 22;
    Object.assign(plaqueEditor.element.style, {
      width: `${width}px`,
      left: `${Math.max(8, Math.min(left, (viewport?.width || window.innerWidth) - width - 8))}px`,
      top: `${Math.max(8, Math.min(top, (viewport?.height || window.innerHeight) - plaqueEditor.element.offsetHeight - 8))}px`,
    });
  }
  function editPlaque(field) {
    closePlaqueEditor();
    const element = document.createElement('div');
    element.className = 'plaque-field-editor';
    const input = document.createElement(field === 'year' ? 'input' : 'select');
    input.setAttribute('aria-label', plaqueOptions[field + 'Label'] || field);
    if (field === 'year') {
      input.type = 'number'; input.min = '1920'; input.max = String(new Date().getFullYear()); input.step = '1';
      input.inputMode = 'numeric'; input.required = true; input.value = draft.year;
    } else {
      const choices = plaqueOptions.genres.map((value) => [value, value]);
      for (const [value, text] of choices) {
        const option = document.createElement('option'); option.value = value; option.textContent = text; input.append(option);
      }
      input.value = draft[field];
    }
    element.append(input);
    const save = () => {
      if (field === 'year') {
        if (!input.checkValidity()) return false;
        draft.year = Number(input.value); draft.ignoreStoreYear = false;
      } else draft[field] = input.value;
      return true;
    };
    if (field === 'year' && plaqueOptions.allowAllYears) {
      const all = document.createElement('button'); all.type = 'button'; all.className = 'plaque-all-years'; all.textContent = plaqueOptions.allYears;
      all.addEventListener('click', () => { draft.ignoreStoreYear = true; closePlaqueEditor(false); renderer.domElement.focus({ preventScroll: true }); });
      element.append(all);
    }
    input.addEventListener('change', () => {
      if (!save()) return;
      closePlaqueEditor(false);
      renderer.domElement.focus({ preventScroll: true });
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); closePlaqueEditor(false); renderer.domElement.focus({ preventScroll: true }); }
      else if (event.key === 'Enter' && save()) { event.preventDefault(); closePlaqueEditor(false); renderer.domElement.focus({ preventScroll: true }); }
    });
    element.addEventListener('focusout', () => { queueMicrotask(() => { if (plaqueEditor?.element === element && !element.contains(document.activeElement)) closePlaqueEditor(); }); });
    document.body.append(element);
    plaqueEditor = { element, field, save };
    positionPlaqueEditor();
    input.focus({ preventScroll: true });
    if (field === 'year') input.select();
    else { try { input.showPicker?.(); } catch { /* The focused native select still supports keyboard and touch. */ } }
  }
  function drawPlaque() {
    const context = signCanvas.canvas.getContext('2d');
    context.fillStyle = '#e7d8b1';
    context.fillRect(0, 0, 1024, 240);
    context.strokeStyle = activeTheme.trim;
    context.lineWidth = 16;
    context.strokeRect(8, 8, 1008, 224);
    context.fillStyle = activeTheme.sign;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = '900 64px Impact, Arial, sans-serif';
    context.fillText(draft.genre.toUpperCase(), 512, 70, 790);
    context.font = '900 26px Arial'; context.fillText('▾', 887, 70);
    context.font = '900 64px Arial';
    context.fillText('‹', 55, 70); context.fillText('›', 969, 70);
    context.fillText('‹', 55, 174); context.fillText('›', 500, 174);
    context.font = draft.ignoreStoreYear ? '900 30px Arial' : '900 76px Courier New';
    context.fillText(draft.ignoreStoreYear ? plaqueOptions.allYears : String(draft.year), 278, 174, 360);
    const visibleProviders = activeProviders.slice(0, 4);
    if (visibleProviders.length) {
      let logoX = 530;
      for (const provider of visibleProviders) {
        const image = providerImages.get(provider.id);
        if (image?.complete && image.naturalWidth) context.drawImage(image, logoX, 148, 32, 32);
        else {
          context.fillStyle = activeTheme.sign;
          context.fillRect(logoX, 148, 32, 32);
          context.fillStyle = '#e7d8b1';
          context.font = '900 10px Arial Narrow, sans-serif';
          context.fillText(provider.displayName.slice(0, 3).toUpperCase(), logoX + 16, 164);
        }
        logoX += 38;
      }
    } else {
      context.font = '900 17px Arial';
      context.fillText(plaqueOptions.allProviders, 620, 164, 130);
    }
    context.fillStyle = '#9e3634'; context.fillRect(700, 125, 295, 95);
    context.fillStyle = '#fff4d1'; context.font = '900 48px Arial';
    context.fillText(plaqueOptions.go, 848, 174);
    signCanvas.texture.needsUpdate = true;
  }
  function plaqueHit(event) {
    if (!plaqueOptions) return null;
    updatePointer(event);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObject(sign, false).find((hit) => hit.face.materialIndex === 4);
  }
  let activeTheme = theme || { backing: '#2f526b', trim: '#527f9e', sign: '#101827', lamp: '#c99a2e' };
  const tvPerformance = performanceProfile === 'tv' || performanceProfile === 'tv-low';
  const mobilePerformance = tvPerformance || window.matchMedia('(max-width: 760px), (max-width: 900px) and (pointer: coarse)').matches;
  const renderer = new THREE.WebGLRenderer({ antialias: !mobilePerformance, alpha: false });
  renderer.setPixelRatio(tvPerformance ? 1 : Math.min(window.devicePixelRatio || 1, mobilePerformance ? 1.25 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = !mobilePerformance;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.className = 'immersive-canvas';
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute('aria-label', `${genre} rental shelf. Use arrow keys to choose a tape and Enter to inspect it.`);
  renderer.domElement.style.touchAction = 'none';
  container.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x06090f);
  scene.fog = new THREE.Fog(0x06090f, 15, 28);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 80);
  camera.position.set(0, 0.55, 18.2);

  const hemisphereLight = new THREE.HemisphereLight(0xffefc2, 0x17150f, 2.1);
  scene.add(hemisphereLight);
  const keyLight = new THREE.SpotLight(0xffe7ad, 75, 30, Math.PI / 4, 0.45, 1.3);
  keyLight.position.set(-4, 8, 8);
  keyLight.castShadow = true;
  scene.add(keyLight);
  const amberLight = new THREE.PointLight(0xc99a2e, 18, 18);
  amberLight.position.set(5, 2, 5);
  scene.add(amberLight);
  // A broad, shadowless overhead fill keeps the compact rack readable without
  // deep silhouettes on the wall posters. It is enabled only on phone layouts.
  const compactOverheadLight = new THREE.PointLight(0xffedc7, 30, 20);
  compactOverheadLight.position.set(0, 7, 4.5);
  compactOverheadLight.visible = false;
  scene.add(compactOverheadLight);

  const room = new THREE.Group();
  scene.add(room);
  const desktopShelfObjects = [];
  const addDesktopShelf = (object) => { room.add(object); desktopShelfObjects.push(object); return object; };
  const wood = new THREE.MeshStandardMaterial({ color: 0x111011, roughness: 0.68, metalness: 0.08 });
  const edge = new THREE.MeshStandardMaterial({ color: 0x080808, roughness: 0.72 });
  const backingMaterial = new THREE.MeshStandardMaterial({ color: activeTheme.backing, roughness: 0.78 });
  const settingWallMaterial = new THREE.MeshStandardMaterial({ color: 0x080d17, roughness: 0.9 });
  const settingWall = new THREE.Mesh(new THREE.BoxGeometry(30, 16, 0.3), settingWallMaterial);
  settingWall.position.set(0, 0.6, -3.15);
  settingWall.receiveShadow = true;
  addDesktopShelf(settingWall);
  const trim = new THREE.MeshStandardMaterial({ color: activeTheme.trim, roughness: 0.72 });
  const backing = new THREE.Mesh(new THREE.BoxGeometry(12, 9.2, 0.35), backingMaterial);
  backing.position.z = -0.45;
  backing.receiveShadow = true;
  addDesktopShelf(backing);

  const featuredPosterGroup = new THREE.Group();
  const featuredPosterLoader = new THREE.TextureLoader();
  const featuredPosterTextures = new Set();
  const featuredPosterFrames = [];
  let featuredRequestToken = 0;
  let featuredYear = '';
  room.add(featuredPosterGroup);
  function clearFeaturedPosters() {
    featuredPosterTextures.forEach((texture) => texture.dispose());
    featuredPosterTextures.clear();
    featuredPosterGroup.traverse((object) => {
      object.geometry?.dispose();
      if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
      else object.material?.dispose();
    });
    featuredPosterGroup.clear();
    featuredPosterFrames.length = 0;
  }
  function layoutFeaturedPosters(key) {
    const portrait = key === 'mobile-portrait';
    const landscape = key === 'mobile-landscape';
    const mobile = portrait || landscape;
    const mobileX = portrait ? [-3.05, 3.05] : [-4.4, 4.4];
    const mobileScale = portrait ? 0.42 : 0.56;
    featuredPosterFrames.forEach((frame, index) => {
      frame.visible = !mobile || index < 2;
      frame.scale.setScalar(mobile ? mobileScale : 1);
      frame.position.set(mobile ? mobileX[index] || 0 : [-9.2, 0, 9.2][index], mobile ? 1.05 : 1.2, -2.94);
    });
  }
  function renderFeaturedPosters(nextTitles) {
    if (disposed) return;
    clearFeaturedPosters();
    if (performanceProfile === 'tv-low') return;
    featuredMovies(nextTitles).forEach((title, index) => {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(4.8, 6.8, 0.08), new THREE.MeshStandardMaterial({ color: 0x171310, roughness: 0.65 }));
      frame.position.set([-9.2, 0, 9.2][index], 1.2, -2.94);
      const posterMaterial = new THREE.MeshBasicMaterial({ color: 0x332820 });
      const poster = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 6.35), posterMaterial);
      poster.position.z = 0.045;
      frame.add(poster);
      featuredPosterGroup.add(frame);
      featuredPosterFrames.push(frame);
      const posterUrl = title.posterUrl || '';
      if (posterUrl) featuredPosterLoader.load(posterUrl, (texture) => {
        if (disposed || frame.parent !== featuredPosterGroup) return texture.dispose();
        texture.colorSpace = THREE.SRGBColorSpace;
        featuredPosterTextures.add(texture);
        posterMaterial.map = texture;
        posterMaterial.needsUpdate = true;
      }, undefined, () => {});
    });
    layoutFeaturedPosters(activeLayoutKey || layoutKey());
  }

  async function loadFeaturedPosters(nextYear) {
    const token = ++featuredRequestToken;
    featuredYear = String(nextYear);
    const featured = await loadFeaturedTitles(nextYear);
    if (!disposed && token === featuredRequestToken) renderFeaturedPosters(featured);
  }

  for (const x of [-6.05, 6.05]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.34, 9.85, 0.72), wood);
    post.position.set(x, -0.12, -0.02);
    post.castShadow = true;
    addDesktopShelf(post);
  }
  for (const y of [-4.25, -2.2, -0.15, 1.9, 3.95]) {
    const board = new THREE.Mesh(new THREE.BoxGeometry(12.4, 0.3, 1.05), wood);
    board.position.set(0, y, 0);
    board.castShadow = true;
    board.receiveShadow = true;
    addDesktopShelf(board);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(12.42, 0.09, 1.08), trim);
    lip.position.set(0, y + 0.18, 0.02);
    addDesktopShelf(lip);
  }

  // This is a separate physical rack for phone-sized screens, inspired by real VHS shelves.
  const compactRack = new THREE.Group();
  compactRack.visible = false;
  room.add(compactRack);
  const compactRackCenterY = 1;
  const compactBacking = new THREE.Mesh(new THREE.BoxGeometry(7.1, 7.4, 0.35), backingMaterial);
  compactBacking.position.set(0, compactRackCenterY, -0.45);
  compactBacking.receiveShadow = true;
  compactRack.add(compactBacking);
  const compactPost = (x) => {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.32, 7.85, 0.72), wood);
    post.position.set(x, compactRackCenterY, -0.02);
    post.castShadow = true;
    compactRack.add(post);
    return post;
  };
  const compactPosts = [compactPost(-3.55), compactPost(3.55)];
  const compactBoards = [];
  const compactLips = [];
  // Four compact rows need only five support boards; the former bottom board
  // belonged to the old five-row phone layout and left an empty tier below.
  for (const y of [-2.5, -.75, 1, 2.75, 4.5]) {
    const board = new THREE.Mesh(new THREE.BoxGeometry(7.45, 0.28, 1.05), wood);
    board.position.set(0, y, 0);
    board.castShadow = true;
    board.receiveShadow = true;
    compactRack.add(board);
    compactBoards.push(board);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(7.47, 0.08, 1.08), trim);
    lip.position.set(0, y + 0.17, 0.02);
    compactRack.add(lip);
    compactLips.push(lip);
  }
  // Size the phone rack to sit just outside the spine cluster so the stand hugs the tapes.
  function fitCompactRack(columns, spacingX, spineWidth, fixedWidth = 0) {
    const halfSpan = ((columns - 1) * spacingX) / 2 + spineWidth / 2;
    const rackHalf = halfSpan + 0.22;
    const boardWidth = fixedWidth || rackHalf * 2;
    compactRackWidth = boardWidth;
    const postX = boardWidth / 2 - 0.18;
    compactBacking.scale.x = boardWidth / 7.1;
    compactBoards.forEach((board) => { board.scale.x = boardWidth / 7.45; });
    compactLips.forEach((lip) => { lip.scale.x = boardWidth / 7.47; });
    compactPosts[0].position.x = -postX;
    compactPosts[1].position.x = postX;
  }

  function fitLamps(compact, dropY = 0, plaqueHalf = 0) {
    const half = compact ? Math.max(compactRackWidth / 2 + 0.05, plaqueHalf - 0.2) : 3.2;
    const y = 6.1 - dropY;
    lampFixtures.forEach((fixture, index) => { fixture.position.set((index === 0 ? -1 : 1) * half, y, 0.62); });
    lamps.forEach((lamp, index) => {
      const x = (index === 0 ? -1 : 1) * half;
      lamp.position.set(x, y - 0.23, 0.7);
      lamp.target.position.x = x;
    });
  }

  let activeProviders = providers;
  const providerImages = new Map();
  let providerLogoKey = '';
  const signCanvas = canvasTexture(1024, 240, (context) => drawSign(context, genre, year, activeTheme, activeProviders, providerImages));
  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(7.9, 1.58, 0.22),
    [edge, edge, edge, edge, new THREE.MeshStandardMaterial({ map: signCanvas.texture, roughness: 0.62 }), edge],
  );
  sign.position.set(0, 5.15, 0.18);
  sign.castShadow = true;
  room.add(sign);

  // A solid hanging shop sign, with the same red lettering and gold offset as the header.
  const brandCanvas = canvasTexture(1536, 256, (context) => {
    context.fillStyle = '#101827';
    context.fillRect(0, 0, 1536, 256);
    context.strokeStyle = '#c99a2e';
    context.lineWidth = 8;
    context.strokeRect(12, 12, 1512, 232);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = '900 158px Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif';
    context.fillStyle = '#c99a2e';
    context.fillText("WILL'S LOCADORA", 778, 140, 1400);
    context.fillStyle = '#9e3634';
    context.fillText("WILL'S LOCADORA", 768, 130, 1400);
  });
  const hangingBrand = new THREE.Group();
  const brandEdge = new THREE.MeshStandardMaterial({ color: 0x896429, roughness: 0.7 });
  const brandFace = new THREE.MeshStandardMaterial({ map: brandCanvas.texture, roughness: 0.65 });
  const brandBoard = new THREE.Mesh(
    new THREE.BoxGeometry(6.1, 1.02, 0.28),
    [brandEdge, brandEdge, brandEdge, brandEdge, brandFace, brandFace],
  );
  hangingBrand.add(brandBoard);
  const ropeMaterial = new THREE.MeshStandardMaterial({ color: 0xb69b70, roughness: 1 });
  const ropeGeometry = new THREE.CylinderGeometry(0.026, 0.026, 30, 6);
  for (const x of [-2.48, 2.48]) {
    const rope = new THREE.Mesh(ropeGeometry, ropeMaterial);
    // End inside the thick board; the other end continues beyond the camera frame.
    rope.position.set(x, 15.48, 0);
    hangingBrand.add(rope);
  }
  room.add(hangingBrand);

  const standCanvas = canvasTexture(320, 160, (context) => drawStandMarker(context, stand));
  const standMarker = new THREE.Mesh(
    new THREE.BoxGeometry(1.36, 0.9, 0.16),
    [edge, edge, edge, edge, new THREE.MeshStandardMaterial({ map: standCanvas.texture, roughness: 0.58 }), edge],
  );
  standMarker.position.set(4.88, 4.88, 0.18);
  standMarker.castShadow = true;
  room.add(standMarker);

  const lampPositions = [-3.2, 3.2];
  const lampFixtures = [];
  const lampBulbs = [];
  const lamps = [];
  const lampShade = new THREE.MeshStandardMaterial({ color: 0x6b321d, metalness: 0.65, roughness: 0.32, side: THREE.DoubleSide });
  const lampBulb = new THREE.MeshStandardMaterial({ color: lighting?.color || activeTheme.lamp, emissive: lighting?.color || activeTheme.lamp, emissiveIntensity: 3.5, roughness: 0.3 });
  for (const x of lampPositions) {
    const fixture = new THREE.Group();
    fixture.position.set(x, 6.05, 0.62);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.45, 12), lampShade);
    stem.position.y = 0.22;
    fixture.add(stem);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.34, 24, 1, true), lampShade);
    shade.position.y = -0.1;
    shade.rotation.x = Math.PI;
    fixture.add(shade);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), lampBulb);
    bulb.position.y = -0.2;
    fixture.add(bulb);
    lampBulbs.push(bulb);
    room.add(fixture);
    lampFixtures.push(fixture);

    const lamp = new THREE.SpotLight(lighting?.color || activeTheme.lamp, 32 * ((lighting?.brightness || 100) / 100), 13, 0.58, 0.6, 1.5);
    lamp.position.set(x, 5.82, 0.7);
    lamp.castShadow = true;
    lamp.shadow.mapSize.set(512, 512);
    lamp.target.position.set(x, 0.2, 0.25);
    room.add(lamp, lamp.target);
    lamps.push(lamp);
  }

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 18),
    new THREE.MeshStandardMaterial({ color: 0x242936, roughness: 0.9 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -4.72;
  floor.receiveShadow = true;
  scene.add(floor);

  const tapes = new THREE.Group();
  room.add(tapes);
  let tapeRecords = [];
  let disposed = false;
  let running = true;
  let hovered = -1;
  let selected = 0;
  let frame = 0;
  let activeTitles = titles;
  let activeLayoutKey = '';
  let activeColumns = COLUMNS;
  let pointerTargetX = 0;
  let pointerTargetY = 0.55;
  let baseCameraDistance = 18.2;
  let targetCameraDistance = 18.2;
  let zoomLevel = 1;
  let sectionZoom = 0;
  let activeStand = stand;
  let standTransition = null;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const activePointers = new Map();
  let pinchPrevDist = 0;
  let dragStart = { x: 0, y: 0, t: 0 };
  let swipeLock = false;
  let dragging = false;
  let mobilePanX = 0;
  let mobilePanY = 0;
  let dragPanBaseX = 0;
  let dragPanBaseY = 0;
  let compactRackWidth = 3.78;
  const compactRoomOffsetY = -1.8;
  const homeLookAt = new THREE.Vector3(0, 0.25, 0);
  const mobilePanLookAt = homeLookAt.clone();
  const sectionFocus = new THREE.Vector3(0, 0.25, 0);
  const cameraLookAt = homeLookAt.clone();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function layoutKey() {
    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    const coarse = window.matchMedia?.('(pointer: coarse)').matches;
    if (width > 760 && !(coarse && width <= 900)) return 'desktop';
    return width >= height ? 'mobile-landscape' : 'mobile-portrait';
  }

  function applyLayoutDecorations(compact) {
    room.position.y = compact ? compactRoomOffsetY : 0;
    compactOverheadLight.visible = compact;
    desktopShelfObjects.forEach((object) => { object.visible = !compact; });
    settingWall.visible = true;
    compactRack.visible = compact;
    featuredPosterGroup.visible = true;
    layoutFeaturedPosters(layoutKey());
    standMarker.visible = true;
    if (compact) {
      const sw = (compactRackWidth + 2.0) / 7.9;
      sign.scale.set(sw, sw, sw);
      const dropY = 1.58 * sw * 0.6;
      sign.position.y = 6.05 - dropY;
      // Keep the stand plaque in the phone camera's compact framing, beside the sign.
      const markerScale = sw * 0.72;
      standMarker.scale.setScalar(markerScale);
      standMarker.position.set((sw * 7.9) / 2 + markerScale * 0.65, sign.position.y - 0.42, 0.18);
      fitLamps(true, dropY, (sw * 7.9) / 2);
    } else {
      standMarker.scale.set(1, 1, 1);
      standMarker.position.set(4.88, 4.88, 0.18);
      sign.scale.set(1, 1, 1);
      sign.position.y = 5.15;
      fitLamps(false);
    }
    const brandScale = compact ? (compactRackWidth + 0.4) / 6.1 : 1;
    hangingBrand.scale.setScalar(brandScale);
    hangingBrand.position.set(0, sign.position.y + 0.79 * sign.scale.y + 0.22 + 0.51 * brandScale, 0.28);
  }

  function clearTapes() {
    for (const record of tapeRecords) {
      record.vhs.dispose();
      tapes.remove(record.group);
    }
    tapeRecords = [];
  }

  function renderTapes(nextTitles) {
    activeTitles = nextTitles;
    clearTapes();
    const currentLayoutKey = layoutKey();
    activeLayoutKey = currentLayoutKey;
    const compact = currentLayoutKey !== 'desktop';
    const landscape = currentLayoutKey === 'mobile-landscape';
    const mobileSpineWidth = .32;
    const mobileSpineGap = landscape ? 0 : .02;
    const mobileRackWidth = landscape ? 4.44 : 3.78;
    const columns = compact ? 10 : COLUMNS;
    activeColumns = columns;
    const spacingX = compact ? mobileSpineWidth + mobileSpineGap : 1.11;
    // Rows pitch to the board pitch (1.75) so all four tiers seat evenly.
    const spacingY = compact ? 1.75 : 2.05;
    if (compact) fitCompactRack(columns, spacingX, mobileSpineWidth, mobileRackWidth);
    applyLayoutDecorations(compact);
    const xOrigin = compact ? -((columns - 1) * spacingX) / 2 : -5;
    // Seat each row on the top face of its support board, not its centre line:
    // board top = 2.75 + 0.14 (half the 0.28 board) and half the 1.42 spine = 0.71,
    // so the top row centre is 2.75 + 0.14 + 0.71 = 3.60. The compact rack is the
    // same object in portrait and landscape, so both share this origin.
    const yOrigin = compact ? 3.6 : 2.9;
    nextTitles.slice(0, MAX_TAPES).forEach((title, index) => {
      const row = Math.floor(index / columns);
      const column = index % COLUMNS;
      const layoutColumn = index % columns;
      const group = new THREE.Group();
      group.position.set(xOrigin + layoutColumn * spacingX, yOrigin - row * spacingY, compact ? 0.38 : 0.34);
      group.userData.baseZ = compact ? 0.38 : 0.34;
      group.rotation.y = compact ? (layoutColumn - (columns - 1) / 2) * -0.012 : (column - 4.5) * -0.007;
      group.userData.index = index;

      const imageOptions = { posterUrl: title.posterUrl, fallbackPosterUrl: title.posterFallbackUrl };
      const vhs = compact
        ? createVhsSpine(title, { ...imageOptions, logoUrl: title.logoUrl, fallbackLogoUrl: title.logoFallbackUrl, width: mobileSpineWidth, height: 1.42, depth: 0.3, labelScale: mobileSpineWidth / .4 })
        : createVhsCase(title, imageOptions);
      const { caseMesh, front } = vhs;
      caseMesh.userData.index = index;
      front.userData.index = index;
      group.add(vhs.group);
      tapes.add(group);
      const record = { title, group, caseMesh, front, material: vhs.material, posterUrl: vhs.posterUrl, vhs };
      tapeRecords.push(record);
    });
    selected = Math.min(selected, Math.max(tapeRecords.length - 1, 0));
  }

  function loadProviderLogos(nextProviders) {
    const nextKey = nextProviders.map((provider) => `${provider.id}:${provider.logoPath || ''}`).join('|');
    if (nextKey === providerLogoKey) return;
    providerLogoKey = nextKey;
    providerImages.clear();
    for (const provider of nextProviders) {
      if (!provider.logoPath) continue;
      const image = new Image();
      image.addEventListener('load', () => { if (!disposed) updateSign(currentGenre, currentYear, currentType); }, { once: true });
      image.src = provider.logoPath;
      providerImages.set(provider.id, image);
    }
  }

  let currentGenre = genre;
  let currentYear = year;
  let currentType = type;

  function applyVisuals(nextVisuals = {}) {
    if (plaqueOptions && Array.isArray(nextVisuals.providers)) {
      plaqueOptions.allowAllYears = nextVisuals.providers.length > 0;
      if (typeof nextVisuals.ignoreStoreYear === 'boolean') draft.ignoreStoreYear = nextVisuals.ignoreStoreYear;
    }
    activeTheme = nextVisuals.theme || activeTheme;
    activeProviders = Array.isArray(nextVisuals.providers) ? nextVisuals.providers : activeProviders;
    backingMaterial.color.set(activeTheme.backing);
    backingMaterial.emissive.set(activeTheme.backing);
    trim.color.set(activeTheme.trim);
    const nextLighting = nextVisuals.lighting || lighting || {};
    const lampColor = nextLighting.color || activeTheme.lamp;
    const intensity = Math.max(0.25, Number(nextLighting.brightness || 100) / 100);
    backingMaterial.emissiveIntensity = 0.08 * intensity;
    trim.emissive.set(activeTheme.trim);
    trim.emissiveIntensity = 0.12 * intensity;
    hemisphereLight.intensity = 2.1 * intensity;
    keyLight.intensity = 75 * intensity;
    amberLight.intensity = 18 * intensity;
    lampBulb.color.set(lampColor);
    lampBulb.emissive.set(lampColor);
    lampBulb.emissiveIntensity = 3.5 * intensity;
    lamps.forEach((lamp) => {
      lamp.color.set(lampColor);
      lamp.intensity = 32 * intensity;
    });
    loadProviderLogos(activeProviders);
  }

  function updateSign(nextGenre, nextYear, nextType, loading = false, nextStand = activeStand) {
    currentGenre = nextGenre;
    currentYear = nextYear;
    currentType = nextType;
    activeStand = nextStand;
    drawSign(signCanvas.canvas.getContext('2d'), nextGenre, nextYear, activeTheme, activeProviders, providerImages, loading);
    signCanvas.texture.needsUpdate = true;
    if (plaqueOptions) {
      drawPlaque();
    }
    drawStandMarker(standCanvas.canvas.getContext('2d'), activeStand);
    standCanvas.texture.needsUpdate = true;
    renderer.domElement.setAttribute('aria-label', `${nextGenre} rental shelf. Use arrow keys to choose a tape and Enter to inspect it.`);
  }

  function updatePointer(event) {
    const bounds = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    // Mouse movement gently steers the desktop POV; touch gestures pan the compact rack.
    if (event.pointerType === 'mouse') {
      pointerTargetX = pointer.x * 0.275;
      pointerTargetY = 0.55 + pointer.y * 0.175;
      sectionFocus.set(pointer.x * 5.15, 0.25 + pointer.y * 3.6, 0);
    }
  }

  function pick(event) {
    updatePointer(event);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects(tapeRecords.flatMap(({ caseMesh, front }) => [caseMesh, front]), false)[0] || null;
  }

  function updateCameraDistance() {
    targetCameraDistance = baseCameraDistance / (zoomLevel * (1 + sectionZoom * 0.6));
  }

  function adjustZoom(amount) {
    if (amount > 0) {
      const globalIncrease = Math.min(amount, MAX_ZOOM - zoomLevel);
      zoomLevel += globalIncrease;
      sectionZoom = THREE.MathUtils.clamp(sectionZoom + amount - globalIncrease, 0, MAX_SECTION_ZOOM);
    } else {
      const zoomOut = -amount;
      const sectionDecrease = Math.min(zoomOut, sectionZoom);
      sectionZoom -= sectionDecrease;
      zoomLevel = THREE.MathUtils.clamp(zoomLevel - (zoomOut - sectionDecrease), MIN_ZOOM, MAX_ZOOM);
    }
    updateCameraDistance();
    if (reducedMotion) camera.position.z = targetCameraDistance;
    return zoomLevel + sectionZoom;
  }

  function wheel(event) {
    updatePointer(event);
    raycaster.setFromCamera(pointer, camera);
    if (!raycaster.intersectObject(room, true).length) return;
    event.preventDefault();
    adjustZoom(event.deltaY < 0 ? 0.1 : -0.1);
  }

  function pointerMove(event) {
    if (event.pointerType !== 'mouse') return;
    const hit = pick(event);
    hovered = hit ? hit.object.userData.index : -1;
    renderer.domElement.style.cursor = hovered >= 0 || plaqueHit(event) ? 'pointer' : 'default';
  }

  function pointerDown(event) {
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    renderer.domElement.setPointerCapture?.(event.pointerId);
    if (activePointers.size === 1) dragStart = { x: event.clientX, y: event.clientY, t: performance.now() };
    pinchPrevDist = 0;
    swipeLock = false;
    dragging = true;
    dragPanBaseX = mobilePanX;
    dragPanBaseY = mobilePanY;
  }

  function pointerMoveGesture(event) {
    if (!activePointers.has(event.pointerId)) return;
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (activePointers.size === 2) {
      const [a, b] = [...activePointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchPrevDist > 0) adjustZoom(((dist - pinchPrevDist) / pinchPrevDist) * 0.9);
      pinchPrevDist = dist;
    } else if (event.pointerType !== 'mouse' && activeLayoutKey !== 'desktop' && dragging) {
      const width = Math.max(renderer.domElement.clientWidth, 1);
      const height = Math.max(renderer.domElement.clientHeight, 1);
      mobilePanX = THREE.MathUtils.clamp(dragPanBaseX - ((event.clientX - dragStart.x) / width) * 4, -2.6, 2.6);
      mobilePanY = THREE.MathUtils.clamp(dragPanBaseY + ((event.clientY - dragStart.y) / height) * 4.5, -3.4, 3.4);
    }
  }

  function pointerUp(event) {
    const wasMulti = activePointers.size > 1;
    activePointers.delete(event.pointerId);
    if (renderer.domElement.hasPointerCapture?.(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
    pinchPrevDist = activePointers.size === 2 ? pinchPrevDist : 0;
    dragging = false;
    if (wasMulti || activePointers.size > 0 || event.pointerType === 'mouse') return;
    const dx = event.clientX - dragStart.x;
    const dy = event.clientY - dragStart.y;
    if (Math.hypot(dx, dy) <= 12) return; // tap: the click event opens the tape
    swipeLock = true;
    setTimeout(() => { swipeLock = false; }, 300);
  }

  function pointerCancel(event) {
    activePointers.delete(event.pointerId);
    if (renderer.domElement.hasPointerCapture?.(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
    pinchPrevDist = 0;
    dragging = false;
  }

  function click(event) {
    if (swipeLock) return;
    const plaque = plaqueHit(event);
    if (plaque) {
      const x = plaque.uv.x * 1024;
      const y = (1 - plaque.uv.y) * 240;
      if (y < 120) {
        if (x > 100 && x < 920) { editPlaque('genre'); return; }
        const choices = plaqueOptions.genres;
        const index = choices.indexOf(draft.genre);
        draft.genre = choices[(index + (x < 512 ? -1 : 1) + choices.length) % choices.length];
      } else if (x < 560) {
        if (x > 100 && x < 455) { editPlaque('year'); return; }
        else {
          draft.ignoreStoreYear = false;
          draft.year = Math.max(1920, Math.min(new Date().getFullYear(), draft.year + (x < 278 ? -1 : 1)));
        }
      } else if (x >= 700) onConfigure?.({ ...draft });
      drawPlaque();
      return;
    }
    const hit = pick(event);
    if (!hit) return;
    selected = hit.object.userData.index;
    const record = tapeRecords[selected];
    if (record) onSelect(record.title, record.posterUrl);
  }

  function keyDown(event) {
    if (event.key === '+' || event.key === '=') {
      adjustZoom(0.12);
      event.preventDefault();
      return;
    }
    if (event.key === '-' || event.key === '_') {
      adjustZoom(-0.12);
      event.preventDefault();
      return;
    }
    if (!tapeRecords.length) return;
    if (event.key === 'ArrowLeft') {
      if (selected % activeColumns === 0 && onBoundary) onBoundary('left');
      else selected = Math.max(0, selected - 1);
    }
    else if (event.key === 'ArrowRight') {
      if ((selected + 1) % activeColumns === 0 || selected === tapeRecords.length - 1) onBoundary?.('right');
      else selected = Math.min(tapeRecords.length - 1, selected + 1);
    }
    else if (event.key === 'ArrowUp') {
      if (selected < activeColumns && onBoundary) onBoundary('up');
      else selected = Math.max(0, selected - activeColumns);
    }
    else if (event.key === 'ArrowDown') {
      if (selected + activeColumns >= tapeRecords.length && onBoundary) onBoundary('down');
      else selected = Math.min(tapeRecords.length - 1, selected + activeColumns);
    }
    else if (event.key === 'Enter' || event.key === ' ') {
      const record = tapeRecords[selected];
      if (record) onSelect(record.title, record.posterUrl);
    } else return;
    event.preventDefault();
  }

  function resize() {
    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    const verticalTangent = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const compact = layoutKey() !== 'desktop';
    const fitHeight = (compact ? 5.2 : 6.05) / verticalTangent;
    const fitWidth = (compact ? 3.9 : 6.45) / (verticalTangent * camera.aspect);
    baseCameraDistance = Math.max(fitHeight, fitWidth) * (compact ? 1.06 : 1.18);
    const nextLayoutKey = layoutKey();
    if (activeLayoutKey && nextLayoutKey !== activeLayoutKey && activeTitles.length) renderTapes(activeTitles);
    else applyLayoutDecorations(nextLayoutKey !== 'desktop');
    updateCameraDistance();
    if (!frame || reducedMotion) camera.position.z = targetCameraDistance;
    scene.fog.near = baseCameraDistance * 0.82;
    scene.fog.far = baseCameraDistance + 14;
    camera.updateProjectionMatrix();
  }

  const observer = new ResizeObserver(resize);
  observer.observe(container);
  renderer.domElement.addEventListener('pointermove', pointerMove);
  renderer.domElement.addEventListener('click', click);
  renderer.domElement.addEventListener('keydown', keyDown);
  renderer.domElement.addEventListener('wheel', wheel, { passive: false });
  renderer.domElement.addEventListener('pointerdown', pointerDown);
  renderer.domElement.addEventListener('pointermove', pointerMoveGesture);
  renderer.domElement.addEventListener('pointerup', pointerUp);
  renderer.domElement.addEventListener('pointercancel', pointerCancel);
  resize();
  renderTapes(titles);
  loadFeaturedPosters(year);
  applyVisuals({});
  if (plaqueOptions) drawPlaque();

  function render(time) {
    if (disposed || !running) return;
    const compactView = activeLayoutKey !== 'desktop';
    const cameraTargetX = compactView ? mobilePanX : pointerTargetX;
    const cameraTargetY = compactView ? compactRoomOffsetY + 0.55 + mobilePanY : pointerTargetY;
    if (!reducedMotion && !compactView) {
      camera.position.x += (cameraTargetX - camera.position.x) * 0.07;
      camera.position.y += (cameraTargetY - camera.position.y) * 0.07;
      camera.position.z += (targetCameraDistance - camera.position.z) * 0.12;
    } else {
      camera.position.x = cameraTargetX;
      camera.position.y = cameraTargetY;
      camera.position.z = targetCameraDistance;
    }
    mobilePanLookAt.set(mobilePanX, compactRoomOffsetY + 0.25 + mobilePanY, 0);
    cameraLookAt.lerp(compactView ? mobilePanLookAt : sectionZoom ? sectionFocus : homeLookAt, reducedMotion || compactView ? 1 : 0.12);
    camera.lookAt(cameraLookAt);
    if (standTransition) {
      const targetX = standTransition.phase === 'out' ? -standTransition.direction * 14 : 0;
      room.position.x += (targetX - room.position.x) * 0.16;
      if (standTransition.phase === 'out' && Math.abs(targetX - room.position.x) < 0.08) {
        updateSign(standTransition.genre, standTransition.year, standTransition.type, false, standTransition.stand);
        renderTapes(standTransition.titles);
        room.position.x = standTransition.direction * 14;
        standTransition.phase = 'in';
      } else if (standTransition.phase === 'in' && Math.abs(room.position.x) < 0.08) {
        room.position.x = 0;
        standTransition = null;
      }
    }
    tapeRecords.forEach((record, index) => {
      const active = index === hovered || index === selected;
      const z = record.group.userData.baseZ + (active ? 0.3 : 0);
      record.group.position.z += (z - record.group.position.z) * 0.16;
      const scale = active ? 1.045 : 1;
      record.group.scale.setScalar(THREE.MathUtils.lerp(record.group.scale.x, scale, 0.16));
      record.material.emissive.setHex(active ? 0x221805 : 0x000000);
    });
    renderer.render(scene, camera);
    positionPlaqueEditor();
    frame = requestAnimationFrame(render);
  }
  frame = requestAnimationFrame(render);

  return {
    setPoster(titleId, posterUrl) {
      const record = tapeRecords.find((entry) => String(entry.title.id) === String(titleId));
      if (record) {
        record.title.posterUrl = posterUrl;
        record.posterUrl = posterUrl;
        record.vhs.setPoster(posterUrl);
        if (titles.indexOf(record.title) < 3) renderFeaturedPosters(titles);
      }
    },
    setActive(active) {
      const nextRunning = Boolean(active);
      if (disposed || nextRunning === running) return;
      running = nextRunning;
      if (running) frame = requestAnimationFrame(render);
      else {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    },
    zoomIn() {
      return adjustZoom(0.12);
    },
    zoomOut() {
      return adjustZoom(-0.12);
    },
    setLoading(nextGenre, nextYear, nextType, nextStand) {
      draft = { ...draft, genre: nextGenre, year: nextYear };
      updateSign(nextGenre, nextYear, nextType, true, nextStand);
    },
    setVisuals(nextVisuals) {
      applyVisuals(nextVisuals);
      updateSign(genre, year, type, false, activeStand);
    },
    setLogo(titleId, logoUrl, fallbackLogoUrl) {
      const record = tapeRecords.find((entry) => entry.title && String(entry.title.id) === String(titleId));
      if (record && typeof record.vhs?.setLogo === 'function') record.vhs.setLogo(logoUrl, fallbackLogoUrl);
    },
    update(nextTitles, nextGenre, nextYear, nextType, nextStand, nextVisuals) {
      if (nextGenre !== currentGenre || nextYear !== currentYear || nextType !== currentType) draft = { ...draft, genre: nextGenre, year: nextYear };
      applyVisuals(nextVisuals);
      standTransition = null;
      room.position.x = 0;
      updateSign(nextGenre, nextYear, nextType, false, nextStand);
      renderFeaturedPosters(nextTitles);
      renderTapes(nextTitles);
    },
    transition(nextTitles, nextGenre, nextYear, nextType, nextStand, direction, nextVisuals) {
      applyVisuals(nextVisuals);
      if (reducedMotion || layoutKey() !== 'desktop' || !direction) {
        this.update(nextTitles, nextGenre, nextYear, nextType, nextStand);
        return;
      }
      hovered = -1;
      selected = 0;
      standTransition = {
        phase: 'out',
        direction: Math.sign(direction),
        titles: nextTitles,
        genre: nextGenre,
        year: nextYear,
        type: nextType,
        stand: nextStand,
      };
    },
    dispose() {
      closePlaqueEditor(false);
      disposed = true;
      featuredRequestToken += 1;
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener('pointermove', pointerMove);
      renderer.domElement.removeEventListener('click', click);
      renderer.domElement.removeEventListener('keydown', keyDown);
      renderer.domElement.removeEventListener('wheel', wheel);
      renderer.domElement.removeEventListener('pointerdown', pointerDown);
      renderer.domElement.removeEventListener('pointermove', pointerMoveGesture);
      renderer.domElement.removeEventListener('pointerup', pointerUp);
      renderer.domElement.removeEventListener('pointercancel', pointerCancel);
      clearTapes();
      clearFeaturedPosters();
      signCanvas.texture.dispose();
      brandCanvas.texture.dispose();
      standCanvas.texture.dispose();
      const geometries = new Set();
      const materials = new Set();
      room.traverse((object) => {
        if (object.geometry) geometries.add(object.geometry);
        if (Array.isArray(object.material)) object.material.forEach((material) => materials.add(material));
        else if (object.material) materials.add(object.material);
      });
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      floor.geometry.dispose();
      floor.material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
