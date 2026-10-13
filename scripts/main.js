const MODULE_ID = "art-library";
const SOCKET = `module.${MODULE_ID}`;

const IMAGE_EXT = /\.(avif|bmp|gif|jpe?g|png|svg|webp)(\?|#|$)/i;
const VIDEO_EXT = /\.(m4v|mov|mp4|ogv|webm)(\?|#|$)/i;

/* -------------------------------------------- */
/*  Media helpers                               */
/* -------------------------------------------- */

function classify(url) {
  const href = String(url ?? "").trim();
  if (!href) return { type: "image", href: "", embed: "", preview: "" };

  const pin = href.match(/(?:pinterest\.[^/]+|pin\.it)\/pin\/(?:[^/?#]*-)?(\d+)/i)
    ?? href.match(/pinterest\.[^/]+\/pin\/(\d+)/i);
  if (pin) {
    const id = pin[1];
    return {
      type: "pin",
      href,
      embed: `https://assets.pinterest.com/ext/embed.html?id=${id}`,
      preview: ""
    };
  }

  const yt = href.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/i);
  if (yt) {
    const id = yt[1];
    return {
      type: "youtube",
      href,
      embed: `https://www.youtube.com/embed/${id}`,
      preview: `https://img.youtube.com/vi/${id}/mqdefault.jpg`
    };
  }

  const vimeo = href.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
  if (vimeo) {
    return {
      type: "vimeo",
      href,
      embed: `https://player.vimeo.com/video/${vimeo[1]}`,
      preview: ""
    };
  }

  if (VIDEO_EXT.test(href)) return { type: "video", href, embed: "", preview: "" };
  return { type: IMAGE_EXT.test(href) ? "image" : "image", href, embed: "", preview: href };
}

function defaultName(url, type) {
  if (type === "pin") return "Pinterest";
  if (type === "youtube") return "YouTube";
  if (type === "vimeo") return "Vimeo";
  try {
    const parsed = new URL(url);
    const file = parsed.pathname.split("/").filter(Boolean).pop();
    return decodeURIComponent((file || parsed.hostname).replace(/\+/g, " "));
  } catch {
    return url;
  }
}

function typeIcon(type) {
  return {
    image: "fa-solid fa-image",
    video: "fa-solid fa-film",
    pin: "fa-brands fa-pinterest",
    youtube: "fa-brands fa-youtube",
    vimeo: "fa-brands fa-vimeo-v"
  }[type] ?? "fa-solid fa-photo-film";
}

function readLibrary() {
  const items = game.settings.get(MODULE_ID, "library");
  return Array.isArray(items) ? foundry.utils.deepClone(items) : [];
}

async function writeLibrary(items) {
  return game.settings.set(MODULE_ID, "library", items);
}

function mediaSrc(url) {
  return /^(https?:|data:|blob:)/i.test(String(url ?? "")) ? url : foundry.utils.getRoute(url);
}

function worldRoot() {
  return `worlds/${game.world.id}`;
}

function isWorldPath(path) {
  const root = worldRoot();
  return path === root || String(path ?? "").startsWith(`${root}/`);
}

function isImagePath(path) {
  const ext = Object.keys(CONST.IMAGE_FILE_EXTENSIONS ?? {});
  return foundry.data.validators.hasFileExtension(path, ext);
}

function itemFromWorldPath(path) {
  if (!isWorldPath(path) || !isImagePath(path)) return null;
  const name = path.split("/").pop();
  return {
    id: `local-${path.replace(/[^\w.-]+/g, "_")}`,
    name,
    url: path,
    type: "image",
    thumbnail: path
  };
}

function resolveItem(ref) {
  if (!ref) return null;
  if (typeof ref === "object") {
    if (ref.url && isWorldPath(ref.url)) return itemFromWorldPath(ref.url) ?? normalizeItem(ref);
    return ref.id ? findItem(ref.id) ?? normalizeItem(ref) : normalizeItem(ref);
  }
  const str = String(ref).trim();
  if (isWorldPath(str)) return itemFromWorldPath(str);
  return findItem(str) ?? readLibrary().find(i => i.name === str) ?? null;
}

function findItem(id) {
  return readLibrary().find(i => i.id === id) ?? null;
}

function normalizeItem({ id, name, url, thumbnail, pinImage, localPath } = {}) {
  const media = classify(url);
  return {
    id: id || foundry.utils.randomID(),
    name: (name || "").trim() || defaultName(url, media.type),
    url: media.href,
    type: media.type,
    thumbnail: (thumbnail || "").trim(),
    pinImage: (pinImage || "").trim(),
    localPath: (localPath || "").trim()
  };
}

function pinIdOf(url) {
  return classify(url).type === "pin"
    ? (String(url).match(/\/pin\/(?:[^/?#]*-)?(\d+)/i)?.[1] ?? "")
    : "";
}

async function resolvePinMeta(url) {
  const id = pinIdOf(url);
  if (!id) return { image: "", title: "" };
  try {
    const res = await fetch(`https://widgets.pinterest.com/v3/pidgets/pins/info/?pin_ids=${id}`);
    if (!res.ok) return { image: "", title: "" };
    const json = await res.json();
    const pin = Array.isArray(json?.data) ? json.data[0] : Object.values(json?.data ?? {})[0];
    const images = pin?.images ?? {};
    const thumb = images["236x"] || images["237x"];
    const best = images["736x"] || images["564x"] || images["474x"] || thumb
      || Object.values(images).sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];
    const title = String(pin?.grid_title || pin?.title || pin?.description || "")
      .split(/\r?\n/)[0]
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
    return { image: best?.url || "", thumb: thumb?.url || best?.url || "", title };
  } catch {
    return { image: "", title: "" };
  }
}

function previewOf(item) {
  if (item.localPath) return mediaSrc(item.localPath);
  if (item.thumbnail) return item.thumbnail.startsWith("http") ? item.thumbnail : mediaSrc(item.thumbnail);
  if (item.pinImage) return item.pinImage;
  return classify(item.url).preview;
}

function filePicker() {
  return foundry.applications.apps.FilePicker.implementation;
}

function isLocalSource(item) {
  if (item?.localPath) return true;
  const url = item?.url || item?.path || "";
  return Boolean(url) && !/^(https?:|data:|blob:)/i.test(url);
}

function sourceBadge(item) {
  const saved = isLocalSource(item);
  return {
    saved,
    sourceIcon: saved ? "fa-solid fa-hard-drive" : "fa-solid fa-globe",
    sourceLabel: game.i18n.localize(saved ? "ARTLIBRARY.Source.Local" : "ARTLIBRARY.Source.Remote")
  };
}

function previewUrl(item) {
  const media = classify(item.url);
  if (item.pinImage) return item.pinImage;
  if (media.type === "youtube" && media.preview) return media.preview;
  if (media.type === "image") return media.href;
  return media.preview || "";
}

function sceneImageSrc(item) {
  if (item?.localPath) return item.localPath;
  const url = item?.url || item?.path || "";
  if (isWorldPath(url) || isImagePath(url)) return url;
  if (item?.pinImage) return item.pinImage;
  const media = classify(url);
  if (media.type === "image" && media.href) return media.href;
  return "";
}

function canCreateScene(item) {
  const type = item?.type || classify(item?.url || item?.path).type;
  return ["image", "pin"].includes(type) && Boolean(sceneImageSrc(item) || item?.type === "pin");
}

function uniqueSceneName(base) {
  const name = String(base || game.i18n.localize("ARTLIBRARY.Scene.Fallback")).trim() || "Scene";
  const taken = new Set(game.scenes.map(scene => scene.name));
  if (!taken.has(name)) return name;
  let n = 2;
  while (taken.has(`${name} (${n})`)) n += 1;
  return `${name} (${n})`;
}

function naturalSize(src) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve({
      width: Math.max(1, img.naturalWidth || 4000),
      height: Math.max(1, img.naturalHeight || 3000)
    });
    img.onerror = () => resolve({ width: 4000, height: 3000 });
    img.src = mediaSrc(src);
  });
}

function isRemoteUrl(url) {
  return /^https?:\/\//i.test(String(url ?? ""));
}

function isLikelyCorsBlocked(url) {
  return /(?:^|\/\/)(?:i\.pinimg\.com|pinimg\.com|media\.pinterest\.com|cdnb?\.artstation\.com|wixmp\.com|deviantart\.net|tumblr\.com|fbcdn\.net)\//i
    .test(String(url ?? ""));
}

function imageProxyUrl(url) {
  const stripped = String(url ?? "").replace(/^https?:\/\//i, "");
  return `https://wsrv.nl/?url=${encodeURIComponent(stripped)}`;
}

function extensionFrom(src, mime = "") {
  const fromMime = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif"
  }[mime];
  if (fromMime) return fromMime;
  const match = String(src).match(/\.(avif|bmp|gif|jpe?g|png|webp)(?:$|\?|#)/i);
  return (match?.[1] || "jpg").toLowerCase().replace("jpeg", "jpg");
}

async function ensureWorldArtFolder() {
  const folder = `${worldRoot()}/art-library`;
  try {
    await filePicker().createDirectory("data", folder);
  } catch { /* exists */ }
  return folder;
}

async function blobFromUrl(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  const blob = await res.blob();
  return blob.type.startsWith("image/") || blob.size > 0 ? blob : null;
}

async function uploadImageBlob(blob, name, src) {
  const folder = await ensureWorldArtFolder();
  const ext = extensionFrom(src, blob.type);
  const safe = String(name || "scene").replace(/[^\w.-]+/g, "_").slice(0, 40) || "scene";
  const file = new File([blob], `${safe}-${foundry.utils.randomID(8)}.${ext}`, {
    type: blob.type || "image/jpeg"
  });
  const uploaded = await filePicker().upload("data", folder, file, {}, { notify: false });
  return uploaded?.path || (typeof uploaded === "string" ? uploaded : "");
}

async function promptLocalImage(preview) {
  const DialogV2 = foundry.applications.api.DialogV2;
  const safePreview = String(preview ?? "").replace(/"/g, "&quot;");
  return new Promise(resolve => {
    let settled = false;
    let app;
    const finish = file => {
      if (settled) return;
      settled = true;
      resolve(file || null);
      app?.close();
    };
    app = new DialogV2({
      window: { title: "ARTLIBRARY.Scene.ImportTitle", icon: "fa-solid fa-file-import" },
      position: { width: 460 },
      content: `
        <div class="al-import">
          <p>${game.i18n.localize("ARTLIBRARY.Scene.ImportHint")}</p>
          ${safePreview ? `<img src="${safePreview}" alt="">` : ""}
          <div class="al-import-drop">${game.i18n.localize("ARTLIBRARY.Scene.ImportDrop")}</div>
          <input type="file" accept="image/*">
        </div>`,
      buttons: [{ action: "cancel", label: "ARTLIBRARY.Library.Cancel", icon: "fa-solid fa-xmark" }]
    });
    app.addEventListener("close", () => finish(null), { once: true });
    app.addEventListener("render", () => {
      const root = app.element;
      const take = file => file?.type.startsWith("image/") && finish(file);
      root.addEventListener("paste", event => {
        const files = [...(event.clipboardData?.files ?? [])];
        const fromItems = [...(event.clipboardData?.items ?? [])]
          .filter(item => item.type.startsWith("image/"))
          .map(item => item.getAsFile())
          .filter(Boolean);
        take(files.find(file => file.type.startsWith("image/")) || fromItems[0]);
      });
      root.addEventListener("dragover", event => event.preventDefault());
      root.addEventListener("drop", event => {
        event.preventDefault();
        take(event.dataTransfer?.files?.[0]);
      });
      root.querySelector("input[type=file]")?.addEventListener("change", event => take(event.target.files?.[0]));
    }, { once: true });
    app.render({ force: true });
  });
}

async function importImageForScene(src, name) {
  if (!isRemoteUrl(src)) return src;

  const tryFetch = async url => {
    try {
      const blob = await blobFromUrl(url);
      if (!blob) return "";
      return uploadImageBlob(blob, name, src);
    } catch {
      return "";
    }
  };

  if (!isLikelyCorsBlocked(src)) {
    const direct = await tryFetch(src);
    if (direct) return direct;
  }

  const proxied = await tryFetch(imageProxyUrl(src));
  if (proxied) return proxied;

  const file = await promptLocalImage(src);
  if (!file) return "";
  return uploadImageBlob(file, name, file.name || src);
}

async function rememberLocalPath(item, path) {
  if (!path || !item?.id || String(item.id).startsWith("local-")) return;
  const items = readLibrary();
  const index = items.findIndex(entry => entry.id === item.id);
  if (index < 0) return;
  items[index].localPath = path;
  await writeLibrary(items);
}

async function applySceneBackground(scene, path) {
  const level = scene.initialLevel ?? scene.levels?.contents?.[0];
  if (level) {
    await level.update({ "background.src": path });
    return;
  }
  if ("levels" in scene) {
    const [created] = await scene.createEmbeddedDocuments("Level", [{ background: { src: path } }]);
    if (created?.id && scene.initialLevel?.id !== created.id) {
      try { await scene.update({ initialLevel: created.id }); } catch { /* default first level */ }
    }
    return;
  }
  await scene.update({ "background.src": path });
}

async function createSceneFromItem(item) {
  if (!game.user.isGM) return ui.notifications.warn("ARTLIBRARY.GMOnly", { localize: true });
  const next = { ...item };
  if (next.type === "pin" && !next.pinImage) {
    next.pinImage = (await resolvePinMeta(next.url)).image;
  }
  const src = sceneImageSrc(next);
  if (!src) return ui.notifications.warn("ARTLIBRARY.Scene.NeedImage", { localize: true });
  const path = await importImageForScene(src, next.name);
  if (!path) return ui.notifications.warn("ARTLIBRARY.Scene.ImportCancel", { localize: true });
  await rememberLocalPath(next, path);
  const { width, height } = await naturalSize(path);
  const scene = await Scene.create({
    name: uniqueSceneName(next.name),
    width,
    height,
    padding: 0.25,
    navigation: true,
    grid: { type: CONST.GRID_TYPES?.GRIDLESS ?? 0 }
  });
  await applySceneBackground(scene, path);
  ui.notifications.info(game.i18n.format("ARTLIBRARY.Scene.Created", { name: scene.name }));
  scene.sheet?.render({ force: true });
  return scene;
}

async function enrichItem(item, previous = {}, { keepName = false } = {}) {
  if (item.type === "pin") {
    const meta = await resolvePinMeta(item.url);
    item.pinImage = meta.image || item.pinImage || "";
    if (!keepName && meta.title) item.name = meta.title;
    else if (!item.name && meta.title) item.name = meta.title;
    if (!item.thumbnail) item.thumbnail = meta.thumb || item.pinImage;
  }
  if (!item.name) item.name = defaultName(item.url, item.type);
  if (!previous.url || item.url !== previous.url || !item.thumbnail) {
    item.thumbnail = previewUrl(item) || item.thumbnail;
  }
  return item;
}

function defaultSize() {
  return {
    width: game.settings.get(MODULE_ID, "width"),
    height: game.settings.get(MODULE_ID, "height")
  };
}

/* -------------------------------------------- */
/*  Viewer                                      */
/* -------------------------------------------- */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

class ArtViewer extends ApplicationV2 {
  constructor(item, { width, height } = {}) {
    const size = defaultSize();
    const fixed = Number.isFinite(width) && Number.isFinite(height);
    super({
      id: `${MODULE_ID}-${item.id}`,
      window: { title: item.name },
      position: { width: width ?? (fixed ? size.width : 360), height: height ?? (fixed ? size.height : 360) }
    });
    this.item = item;
    this.#fixedSize = fixed;
  }

  #fixedSize = false;

  static DEFAULT_OPTIONS = {
    classes: ["art-viewer"],
    window: { icon: "fa-solid fa-photo-film", resizable: true },
    actions: {
      share: ArtViewer.#onShare,
      closeAll: ArtViewer.#onCloseAll
    }
  };

  _getHeaderControls() {
    const controls = super._getHeaderControls();
    if (game.user.isGM) {
      controls.push(
        { icon: "fa-solid fa-share-nodes", label: "ARTLIBRARY.Share.Button", action: "share" },
        { icon: "fa-solid fa-users-slash", label: "ARTLIBRARY.CloseAll", action: "closeAll" }
      );
    }
    return controls;
  }

  async _renderHTML() {
    const wrap = document.createElement("div");
    wrap.className = "al-view";
    const media = classify(this.item.url);
    if (this.item.localPath) {
      const img = document.createElement("img");
      img.src = mediaSrc(this.item.localPath);
      img.alt = this.item.name;
      wrap.append(img);
      return wrap;
    }
    if (media.type === "pin" && !this.item.pinImage) {
      this.item.pinImage = (await resolvePinMeta(this.item.url)).image;
    }
    const pinSrc = this.item.pinImage;
    if (pinSrc) {
      const img = document.createElement("img");
      img.src = pinSrc;
      img.alt = this.item.name;
      wrap.append(img);
    } else if (media.embed && media.type === "pin") {
      wrap.classList.add("al-pin");
      const frame = document.createElement("iframe");
      frame.src = `${media.embed}&terse=true`;
      frame.setAttribute("allow", "encrypted-media; fullscreen");
      frame.setAttribute("allowfullscreen", "");
      wrap.append(frame);
    } else if (media.embed) {
      const frame = document.createElement("iframe");
      frame.src = media.embed;
      frame.setAttribute("allow", "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen");
      frame.setAttribute("allowfullscreen", "");
      wrap.append(frame);
    } else if (media.type === "video") {
      const video = document.createElement("video");
      video.src = mediaSrc(media.href);
      video.controls = true;
      video.playsInline = true;
      wrap.append(video);
    } else {
      const img = document.createElement("img");
      img.src = mediaSrc(pinSrc || media.href);
      img.alt = this.item.name;
      wrap.append(img);
    }
    return wrap;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
  }

  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    if (!this.#fixedSize) this.#bindFit();
  }

  #bindFit() {
    const node = this.element.querySelector(".al-view img, .al-view video");
    if (node) {
      const apply = () => {
        const w = node.naturalWidth || node.videoWidth;
        const h = node.naturalHeight || node.videoHeight;
        if (w && h) this.#fitToMedia(w, h, node.tagName === "VIDEO" ? 40 : 0);
      };
      if (node.naturalWidth || node.videoWidth) apply();
      else node.addEventListener(node.tagName === "VIDEO" ? "loadedmetadata" : "load", apply, { once: true });
      return;
    }
    const { type } = classify(this.item.url);
    if (type === "youtube" || type === "vimeo") this.#fitToMedia(1280, 720);
    else if (type === "pin") this.#fitToMedia(345, 460);
  }

  /** Size the window to the media. Never larger than the source, never larger than the screen. */
  #fitToMedia(naturalWidth, naturalHeight, extraHeight = 0) {
    const maxW = Math.floor(window.innerWidth * 0.9);
    const maxH = Math.floor(window.innerHeight * 0.9);
    const header = this.element.querySelector(".window-header")?.getBoundingClientRect().height ?? 36;
    const chrome = header + extraHeight + 4;
    const scale = Math.min(1, maxW / naturalWidth, (maxH - chrome) / naturalHeight);
    this.setPosition({
      width: Math.max(280, Math.round(naturalWidth * scale)),
      height: Math.max(200, Math.round((naturalHeight * scale) + chrome))
    });
  }

  static #onShare() {
    shareItem(this.item, { width: this.position.width, height: this.position.height });
  }

  static #onCloseAll() {
    api.closeForAll(this.item);
  }
}

/* -------------------------------------------- */
/*  Library                                     */
/* -------------------------------------------- */

class ArtLibrary extends HandlebarsApplicationMixin(ApplicationV2) {
  static #instance = null;

  static get instance() {
    return this.#instance;
  }

  static open() {
    if (!game.user.isGM) return ui.notifications.warn("ARTLIBRARY.GMOnly", { localize: true });
    this.#instance ??= new this();
    this.#instance.render({ force: true });
    return this.#instance;
  }

  static DEFAULT_OPTIONS = {
    id: "art-library",
    classes: ["art-library"],
    window: { title: "ARTLIBRARY.Library.Title", icon: "fa-solid fa-photo-film", resizable: true },
    position: { width: 720, height: 680 },
    actions: {
      add: ArtLibrary.#onAdd,
      save: ArtLibrary.#onSave,
      cancel: ArtLibrary.#onCancel,
      open: ArtLibrary.#onOpen,
      share: ArtLibrary.#onShare,
      edit: ArtLibrary.#onEdit,
      remove: ArtLibrary.#onRemove,
      setTab: ArtLibrary.#onSetTab,
      openFolder: ArtLibrary.#onOpenFolder,
      openFile: ArtLibrary.#onOpenFile,
      shareFile: ArtLibrary.#onShareFile,
      createScene: ArtLibrary.#onCreateScene,
      createSceneFile: ArtLibrary.#onCreateSceneFile
    }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/library.hbs`, scrollable: [".window-content"] }
  };

  #editId = null;
  #tab = "links";
  #folder = "";

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const items = readLibrary().map(item => ({
      ...item,
      preview: previewOf(item),
      icon: typeIcon(item.type),
      typeLabel: game.i18n.localize(`ARTLIBRARY.Type.${item.type}`),
      ...sourceBadge(item),
      canScene: canCreateScene(item)
    }));
    const editing = this.#editId ? findItem(this.#editId) : null;
    const world = this.#tab === "world" ? await this.#browseWorld() : { crumbs: [], folders: [], files: [] };
    return Object.assign(context, {
      tabLinks: this.#tab === "links",
      tabWorld: this.#tab === "world",
      items,
      form: {
        id: editing?.id ?? "",
        name: editing?.name ?? "",
        url: editing?.url ?? ""
      },
      ...world
    });
  }

  async #browseWorld() {
    const root = worldRoot();
    const folder = isWorldPath(this.#folder) ? this.#folder : root;
    this.#folder = folder;
    let listed = { files: [], dirs: [] };
    try {
      listed = await filePicker().browse("data", folder);
    } catch (err) {
      console.warn(`${MODULE_ID} | world browse failed`, err);
    }
    const files = (listed.files ?? []).filter(isImagePath).map(path => ({
      path,
      name: path.split("/").pop(),
      preview: mediaSrc(path),
      ...sourceBadge({ path }),
      canScene: true
    }));
    const folders = (listed.dirs ?? []).filter(isWorldPath).map(path => ({
      path,
      name: path.split("/").pop()
    }));
    const parts = folder.slice(root.length).split("/").filter(Boolean);
    const crumbs = [
      { path: root, label: game.world.title, current: folder === root }
    ];
    let walk = root;
    for (const part of parts) {
      walk = `${walk}/${part}`;
      crumbs.push({ path: walk, label: part, current: walk === folder });
    }
    return { crumbs, folders, files };
  }

  #formData() {
    const form = this.element.querySelector(".al-form");
    const data = new FormData(form);
    return {
      name: String(data.get("name") ?? "").trim(),
      url: String(data.get("url") ?? "").trim()
    };
  }

  static async #onAdd() {
    const fields = this.#formData();
    if (!fields.url) return ui.notifications.warn("ARTLIBRARY.NeedUrl", { localize: true });
    const items = readLibrary();
    items.push(await enrichItem(normalizeItem({ url: fields.url })));
    await writeLibrary(items);
    this.#editId = null;
    ui.notifications.info("ARTLIBRARY.Saved", { localize: true });
    this.render();
  }

  static async #onSave() {
    const fields = this.#formData();
    if (!fields.url) return ui.notifications.warn("ARTLIBRARY.NeedUrl", { localize: true });
    const items = readLibrary();
    const index = items.findIndex(i => i.id === this.#editId);
    if (index < 0) return;
    items[index] = await enrichItem(normalizeItem({ ...items[index], url: fields.url, name: fields.name }), items[index], { keepName: true });
    await writeLibrary(items);
    this.#editId = null;
    ui.notifications.info("ARTLIBRARY.Saved", { localize: true });
    this.render();
  }

  static #onCancel() {
    this.#editId = null;
    this.render();
  }

  static #onOpen(event, target) {
    api.open(target.dataset.id);
  }

  static #onShare(event, target) {
    shareItem(target.dataset.id);
  }

  static #onEdit(event, target) {
    this.#editId = target.dataset.id;
    this.render();
  }

  static async #onRemove(event, target) {
    const item = findItem(target.dataset.id);
    if (!item) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "ARTLIBRARY.Delete" },
      content: `<p>${game.i18n.format("ARTLIBRARY.DeleteConfirm", { name: foundry.utils.escapeHTML(item.name) })}</p>`
    });
    if (!ok) return;
    await writeLibrary(readLibrary().filter(i => i.id !== item.id));
    if (this.#editId === item.id) this.#editId = null;
    this.render();
  }

  static #onSetTab(event, target) {
    this.#tab = target.dataset.tab === "world" ? "world" : "links";
    this.render();
  }

  static #onOpenFolder(event, target) {
    const path = target.dataset.path;
    if (!isWorldPath(path)) return;
    this.#folder = path;
    this.render();
  }

  static #onOpenFile(event, target) {
    api.open(itemFromWorldPath(target.dataset.path));
  }

  static #onShareFile(event, target) {
    shareItem(itemFromWorldPath(target.dataset.path));
  }

  static #onCreateScene(event, target) {
    const item = findItem(target.dataset.id);
    if (item) createSceneFromItem(item);
  }

  static #onCreateSceneFile(event, target) {
    const item = itemFromWorldPath(target.dataset.path);
    if (item) createSceneFromItem(item);
  }
}

/* -------------------------------------------- */
/*  API                                         */
/* -------------------------------------------- */

const windows = new Map();

function openLocal(item, options = {}) {
  const existing = windows.get(item.id);
  if (existing?.rendered) {
    existing.bringToFront();
    return existing;
  }
  const app = new ArtViewer(item, options);
  windows.set(item.id, app);
  app.addEventListener("close", () => windows.delete(item.id), { once: true });
  app.render({ force: true });
  return app;
}

function emit(payload) {
  game.socket.emit(SOCKET, { ...payload, senderId: game.user.id });
}

function selectedUserIds(root) {
  return [...(root?.querySelectorAll(".al-share-user:checked") ?? [])].map(el => el.dataset.userId).filter(Boolean);
}

function userNames(ids) {
  return ids.map(id => game.users.get(id)?.name).filter(Boolean).join(", ");
}

function chatImageSrc(item) {
  const preview = previewOf(item);
  if (preview) return preview;
  if (item?.type === "image" && item.url) return mediaSrc(item.url);
  return "";
}

function chatMediaHtml(item, caption = "") {
  const img = chatImageSrc(item);
  const name = foundry.utils.escapeHTML(item.name || "");
  const href = foundry.utils.escapeHTML(item.url || "");
  const id = foundry.utils.escapeHTML(item.id || "");
  let html = img
    ? `<img class="al-chat-image" src="${foundry.utils.escapeHTML(img)}" alt="${name}" data-al-id="${id}" data-al-url="${href}">`
    : `<p><a href="${href}">${name || href}</a></p>`;
  if (caption) html += `<p class="al-chat-caption">${foundry.utils.escapeHTML(caption)}</p>`;
  return html;
}

async function postToChat(item, { caption = "", userIds = [] } = {}) {
  const data = { content: chatMediaHtml(item, caption) };
  if (userIds.length) data.whisper = userIds;
  await ChatMessage.create(data);
  ui.notifications.info(userIds.length
    ? game.i18n.format("ARTLIBRARY.Share.ChatWhispered", { name: item.name, users: userNames(userIds) })
    : game.i18n.format("ARTLIBRARY.Share.ChatPosted", { name: item.name }));
}

function shareDialogContent(item) {
  const preview = previewOf(item);
  const users = game.users.filter(user => user.id !== game.user.id);
  const rows = users.map(user => `
    <label class="al-share-row">
      <input type="checkbox" class="al-share-user" data-user-id="${user.id}">
      ${foundry.utils.escapeHTML(user.name)}
    </label>`).join("");
  return `
    <div class="al-share">
      ${preview ? `<img src="${foundry.utils.escapeHTML(preview)}" alt="">` : ""}
      <input type="text" name="caption" placeholder="${game.i18n.localize("ARTLIBRARY.Share.Caption")}">
      <strong>${game.i18n.localize("ARTLIBRARY.Share.To")}</strong>
      <p class="al-share-hint">${game.i18n.localize("ARTLIBRARY.Share.Hint")}</p>
      <div class="al-share-users">
        ${users.length ? `<label class="al-share-row al-share-toggle"><input type="checkbox" class="al-share-all"> ${game.i18n.localize("ARTLIBRARY.Share.SelectAll")}</label>${rows}` : `<p>${game.i18n.localize("ARTLIBRARY.Share.NoUsers")}</p>`}
      </div>
    </div>`;
}

function shareItem(ref, { width, height } = {}) {
  if (!game.user.isGM) return ui.notifications.warn("ARTLIBRARY.GMOnly", { localize: true });
  const item = resolveItem(ref);
  if (!item?.url) {
    return ui.notifications.warn(game.i18n.format("ARTLIBRARY.NotFound", { ref: String(ref?.url ?? ref) }));
  }
  const app = new foundry.applications.api.DialogV2({
    window: { title: "ARTLIBRARY.Share.Title", icon: "fa-solid fa-share-nodes" },
    classes: ["al-share-app"],
    position: { width: 360 },
    content: shareDialogContent(item),
    buttons: [
      {
        action: "windowAll",
        label: "ARTLIBRARY.Share.WindowAll",
        icon: "fa-solid fa-users",
        callback: () => {
          api.openForAll(item, { width, height });
          return true;
        }
      },
      {
        action: "windowSelected",
        label: "ARTLIBRARY.Share.WindowSelected",
        icon: "fa-solid fa-user-check",
        callback: (_event, button) => {
          const ids = selectedUserIds(button.form);
          if (!ids.length) {
            ui.notifications.warn("ARTLIBRARY.Share.NeedUsers", { localize: true });
            return false;
          }
          api.open(item, { userIds: ids, width, height });
          ui.notifications.info(game.i18n.format("ARTLIBRARY.SharedWith", {
            name: item.name,
            users: userNames(ids)
          }));
          return true;
        }
      },
      {
        action: "chat",
        label: "ARTLIBRARY.Share.Chat",
        icon: "fa-solid fa-comment",
        callback: async (_event, button) => {
          const caption = button.form.querySelector('[name="caption"]')?.value?.trim() ?? "";
          await postToChat(item, { caption, userIds: selectedUserIds(button.form) });
          return true;
        }
      }
    ]
  });
  app.addEventListener("render", () => {
    const all = app.element.querySelector(".al-share-all");
    if (!all) return;
    all.addEventListener("change", () => {
      app.element.querySelectorAll(".al-share-user").forEach(box => {
        box.checked = all.checked;
      });
    });
  }, { once: true });
  return app.render({ force: true });
}

const api = {
  openLibrary() {
    return ArtLibrary.open();
  },

  /**
   * Open a media item.
   * @param {string|object} ref   Library id, name, or {url, name}
   * @param {object} [options]
   */
  open(ref, { userId, userIds, width, height } = {}) {
    const item = resolveItem(ref);
    if (!item?.url) {
      ui.notifications.warn(game.i18n.format("ARTLIBRARY.NotFound", { ref: String(ref?.url ?? ref) }));
      return null;
    }

    const targets = userIds ?? (userId ? [userId] : [game.user.id]);
    const others = targets.filter(id => id !== game.user.id);
    if (others.length) {
      if (!game.user.isGM) ui.notifications.warn("ARTLIBRARY.GMOnly", { localize: true });
      else emit({ action: "open", item, userIds: others, width, height });
    }
    if (targets.includes(game.user.id)) return openLocal(item, { width, height });
    return null;
  },

  openForAll(ref, { width, height } = {}) {
    if (!game.user.isGM) return ui.notifications.warn("ARTLIBRARY.GMOnly", { localize: true });
    const item = resolveItem(ref);
    if (!item?.url) return ui.notifications.warn(game.i18n.format("ARTLIBRARY.NotFound", { ref: String(ref) }));
    emit({ action: "open", item, userIds: null, width, height });
    ui.notifications.info(game.i18n.format("ARTLIBRARY.Shared", { name: item.name }));
    return openLocal(item, { width, height });
  },

  share(ref, options = {}) {
    return shareItem(ref, options);
  },

  postToChat(ref, { caption, userIds } = {}) {
    if (!game.user.isGM) return ui.notifications.warn("ARTLIBRARY.GMOnly", { localize: true });
    const item = resolveItem(ref);
    if (!item?.url) return ui.notifications.warn(game.i18n.format("ARTLIBRARY.NotFound", { ref: String(ref) }));
    return postToChat(item, { caption, userIds });
  },

  closeForAll(ref) {
    if (!game.user.isGM) return ui.notifications.warn("ARTLIBRARY.GMOnly", { localize: true });
    const item = resolveItem(ref);
    if (!item) return;
    emit({ action: "close", itemId: item.id, userIds: null });
    windows.get(item.id)?.close();
  },

  close(ref) {
    if (!ref) return Promise.all([...windows.values()].map(w => w.close()));
    const item = resolveItem(ref);
    return item ? windows.get(item.id)?.close() : null;
  },

  async add(data) {
    if (!game.user.isGM) return ui.notifications.warn("ARTLIBRARY.GMOnly", { localize: true });
    const item = await enrichItem(normalizeItem(data), {}, { keepName: !!data?.name });
    if (!item.url) return ui.notifications.warn("ARTLIBRARY.NeedUrl", { localize: true });
    const items = readLibrary();
    items.push(item);
    return writeLibrary(items).then(() => {
      ArtLibrary.instance?.render();
      return item;
    });
  }
};

function onSocket(data) {
  if (data?.senderId === game.user.id) return;
  if (!game.users.get(data?.senderId)?.isGM) return;
  if (Array.isArray(data.userIds) && !data.userIds.includes(game.user.id)) return;
  if (data.action === "open" && data.item) openLocal(data.item, { width: data.width, height: data.height });
  else if (data.action === "close") windows.get(data.itemId)?.close();
}

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "library", {
    scope: "world",
    config: false,
    type: Array,
    default: []
  });
  game.settings.register(MODULE_ID, "width", {
    name: "ARTLIBRARY.Settings.Width.Name",
    hint: "ARTLIBRARY.Settings.Width.Hint",
    scope: "world",
    config: true,
    type: Number,
    default: 720
  });
  game.settings.register(MODULE_ID, "height", {
    name: "ARTLIBRARY.Settings.Height.Name",
    hint: "ARTLIBRARY.Settings.Height.Hint",
    scope: "world",
    config: true,
    type: Number,
    default: 800
  });
  game.modules.get(MODULE_ID).api = api;
});

async function migrateLegacyLibrary() {
  const current = game.settings.get(MODULE_ID, "library");
  if (Array.isArray(current) && current.length) return;
  try {
    const stored = game.settings.storage.get("world")?.get("media-window.library");
    if (stored == null) return;
    const parsed = typeof stored === "string" ? JSON.parse(stored) : stored;
    if (Array.isArray(parsed) && parsed.length) await game.settings.set(MODULE_ID, "library", parsed);
  } catch { /* no previous media-window library */ }
}

Hooks.once("ready", async () => {
  await migrateLegacyLibrary();
  game.socket.on(SOCKET, onSocket);
  document.addEventListener("click", event => {
    const img = event.target.closest?.(".al-chat-image");
    if (!img) return;
    const item = resolveItem(img.dataset.alId) ?? (img.dataset.alUrl ? resolveItem(img.dataset.alUrl) : null);
    if (item) api.open(item);
    else if (img.getAttribute("src")) {
      new foundry.applications.apps.ImagePopout({ src: img.getAttribute("src") }).render({ force: true });
    }
  });
});

Hooks.on("getSceneControlButtons", controls => {
  if (!game.user.isGM) return;
  controls.artLibrary = {
    name: "artLibrary",
    title: "ARTLIBRARY.Library.Title",
    icon: "fa-solid fa-photo-film",
    order: 90,
    visible: game.user.isGM,
    tools: {
      library: {
        name: "library",
        order: 1,
        title: "ARTLIBRARY.Library.Title",
        icon: "fa-solid fa-photo-film",
        button: true,
        onChange: () => api.openLibrary()
      }
    }
  };
});
