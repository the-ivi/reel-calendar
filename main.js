const {
  Plugin,
  ItemView,
  Modal,
  FuzzySuggestModal,
  PluginSettingTab,
  Setting,
  Notice,
  TFile,
  TFolder,
  setIcon,
  requestUrl
} = require('obsidian');

const VIEW_TYPE = 'reel-calendar-view';
const TMDB_API_BASE = 'https://api.themoviedb.org/3';
const TMDB_WEBSITE = 'https://www.themoviedb.org';
const TMDB_LOGO = 'https://www.themoviedb.org/assets/2/v4/logos/v2/blue_square_2-d537fb228cf3ded904ef09b136fe3fec72548ebc1fea3fbbd1ad9e36364db38b.svg';
const TMDB_NOTICE = 'This product uses the TMDB API but is not endorsed or certified by TMDB.';

const DEFAULT_SETTINGS = {
  movieFolder: '',
  templatePath: '',
  colourMode: 'monthly',
  firstDayOfWeek: 'monday',
  defaultSource: 'physical',
  tmdbCredential: '',
  tmdbAuthType: 'api-key',
  tmdbLanguage: 'en-GB',
  tmdbRegion: 'GB'
};

const SOURCE_LABELS = {
  physical: 'Physical',
  prime: 'Amazon Prime',
  'free-streaming': 'Free streaming',
  other: 'Other'
};

const MONTH_CLASSES = Array.from({ length: 12 }, (_, index) => `rc-month-${index + 1}`);

const MOVIE_TEMPLATE_FALLBACK = `---
title: "{{title}}"
director:
writer:
cast:
production:
studio:
genre:
group:
released:
last_watched:
watched:
rating:
trailer:
cover:
banner:
logo:
---
`;

class ReelCalendarPlugin extends Plugin {
  async onload() {
    await this.loadState();
    this.tmdbConfiguration = null;
    this.registerView(VIEW_TYPE, leaf => new ReelCalendarView(leaf, this));
    this.addRibbonIcon('calendar-days', 'Open Reel Calendar', () => this.activateView());

    this.addCommand({ id: 'open-reel-calendar', name: 'Open calendar', callback: () => this.activateView() });
    this.addCommand({ id: 'add-viewing-to-reel-calendar', name: 'Add viewing', callback: () => this.openViewingModal(new Date()) });
    this.addSettingTab(new ReelCalendarSettingTab(this.app, this));

    this.registerEvent(this.app.metadataCache.on('changed', file => {
      if (file.extension === 'md') this.refreshViews();
    }));
    this.registerEvent(this.app.vault.on('delete', file => this.handleDelete(file)));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.handleRename(file, oldPath)));
    this.app.workspace.onLayoutReady(async () => {
      await this.migrateLegacyNotes();
      this.refreshViews();
    });
  }

  async onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  async loadState() {
    const stored = await this.loadData() || {};
    if (stored.settings || stored.viewings) {
      this.settings = Object.assign({}, DEFAULT_SETTINGS, stored.settings || {});
      this.viewings = Array.isArray(stored.viewings) ? stored.viewings : [];
      this.migrationVersion = Number(stored.migrationVersion || 0);
      return;
    }
    this.settings = Object.assign({}, DEFAULT_SETTINGS, stored);
    this.viewings = [];
    this.migrationVersion = 0;
  }

  async saveState() {
    await this.saveData({ settings: this.settings, viewings: this.viewings, migrationVersion: this.migrationVersion });
  }

  async saveSettings() {
    await this.saveState();
    this.refreshViews();
  }

  async activateView() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf('tab');
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
  }

  openViewingModal(date) {
    if (!cleanPath(this.settings.movieFolder)) {
      new Notice('Choose your movie notes folder in Reel Calendar settings first');
      this.openPluginSettings();
      return;
    }
    new ViewingModal(this.app, this, date).open();
  }

  openPluginSettings() {
    if (this.app.setting?.open) {
      this.app.setting.open();
      this.app.setting.openTabById?.(this.manifest.id);
    }
  }

  refreshViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view && typeof leaf.view.scheduleRender === 'function') leaf.view.scheduleRender();
    }
  }

  getMovieNotes() {
    const folder = cleanPath(this.settings.movieFolder);
    if (!folder) return [];
    const prefix = `${folder}/`;
    return this.app.vault.getMarkdownFiles()
      .filter(file => file.path.startsWith(prefix) && file.path !== this.settings.templatePath)
      .map(file => {
        const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
        return {
          file,
          title: String(frontmatter.title || file.basename),
          cover: firstString(frontmatter.cover, frontmatter.poster),
          released: frontmatter.released ? String(frontmatter.released) : ''
        };
      })
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
  }

  getCalendarEntries() {
    const notes = new Map(this.getMovieNotes().map(movie => [movie.file.path, movie]));
    return this.viewings
      .map(viewing => {
        const movie = notes.get(viewing.filePath);
        return movie ? { ...viewing, movie } : null;
      })
      .filter(Boolean);
  }

  findMatchingMovie(title) {
    const target = normaliseTitle(title);
    return this.getMovieNotes().find(movie =>
      normaliseTitle(movie.title) === target || normaliseTitle(movie.file.basename) === target
    ) || null;
  }

  hasTmdbCredential() {
    return Boolean(String(this.settings.tmdbCredential || '').trim());
  }

  async tmdbRequest(path, params = {}) {
    const credential = String(this.settings.tmdbCredential || '').trim();
    if (!credential) throw new Error('Add a TMDB credential in Reel Calendar settings first');

    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
    }
    const headers = { Accept: 'application/json' };
    if (this.settings.tmdbAuthType === 'read-token') headers.Authorization = `Bearer ${credential}`;
    else query.set('api_key', credential);

    const response = await requestUrl({
      url: `${TMDB_API_BASE}${path}?${query.toString()}`,
      method: 'GET',
      headers,
      throw: false
    });
    if (response.status < 200 || response.status >= 300) {
      const message = response.json?.status_message || `TMDB returned HTTP ${response.status}`;
      throw new Error(message);
    }
    return response.json;
  }

  async validateTmdbCredential() {
    await this.tmdbRequest('/authentication');
    return true;
  }

  async searchTmdbMovies(query) {
    const data = await this.tmdbRequest('/search/movie', {
      query,
      include_adult: false,
      language: this.settings.tmdbLanguage || 'en-US',
      region: this.settings.tmdbRegion || undefined,
      page: 1
    });
    return Array.isArray(data.results) ? data.results.slice(0, 20) : [];
  }

  async chooseTmdbMovie(query) {
    const results = await this.searchTmdbMovies(query);
    if (!results.length) {
      new Notice(`TMDB found no movie results for “${query}”`);
      return null;
    }
    return new Promise(resolve => {
      new TmdbMovieSuggestModal(this.app, results, resolve).open();
    });
  }

  async getTmdbConfiguration() {
    if (!this.tmdbConfiguration) this.tmdbConfiguration = await this.tmdbRequest('/configuration');
    return this.tmdbConfiguration;
  }

  async getTmdbMetadata(movieId) {
    const language = this.settings.tmdbLanguage || 'en-US';
    const imageLanguage = language.split('-')[0];
    const [details, configuration] = await Promise.all([
      this.tmdbRequest(`/movie/${movieId}`, {
        language,
        append_to_response: 'credits,videos,images',
        include_image_language: `${imageLanguage},null`
      }),
      this.getTmdbConfiguration()
    ]);

    const crew = Array.isArray(details.credits?.crew) ? details.credits.crew : [];
    const cast = Array.isArray(details.credits?.cast) ? details.credits.cast : [];
    const writers = crew.filter(person =>
      person.department === 'Writing'
      || ['Writer', 'Screenplay', 'Story', 'Teleplay', 'Adaptation', 'Novel'].includes(person.job)
    );
    const producers = crew.filter(person => ['Producer', 'Executive Producer'].includes(person.job));
    const videos = Array.isArray(details.videos?.results) ? details.videos.results : [];
    const trailer = videos.find(video => video.site === 'YouTube' && video.type === 'Trailer' && video.official)
      || videos.find(video => video.site === 'YouTube' && video.type === 'Trailer');
    const logos = Array.isArray(details.images?.logos) ? details.images.logos : [];
    const preferredLogo = [...logos].sort((a, b) => {
      const aLanguage = a.iso_639_1 === imageLanguage ? 1 : 0;
      const bLanguage = b.iso_639_1 === imageLanguage ? 1 : 0;
      return bLanguage - aLanguage || Number(b.vote_average || 0) - Number(a.vote_average || 0);
    })[0];

    return {
      title: details.title || details.original_title || '',
      director: uniqueNames(crew.filter(person => person.job === 'Director')),
      writer: uniqueNames(writers),
      cast: uniqueNames(cast.sort((a, b) => Number(a.order || 0) - Number(b.order || 0)).slice(0, 12)),
      production: uniqueNames(producers).slice(0, 12),
      studio: uniqueStrings((details.production_companies || []).map(company => company.name)),
      genre: uniqueStrings((details.genres || []).map(genre => genre.name)),
      group: details.belongs_to_collection?.name || '',
      released: normaliseDate(details.release_date),
      rating: Number(details.vote_average || 0) > 0 ? Number(Number(details.vote_average).toFixed(1)) : '',
      trailer: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : '',
      cover: tmdbImageUrl(configuration, details.poster_path, 'poster'),
      banner: tmdbImageUrl(configuration, details.backdrop_path, 'backdrop'),
      logo: tmdbImageUrl(configuration, preferredLogo?.file_path, 'logo')
    };
  }

  async addViewing(file, data, silent = false) {
    const date = normaliseDate(data.date);
    if (!date) throw new Error('A valid viewing date is required');
    const duplicate = this.viewings.find(viewing => viewing.filePath === file.path && viewing.date === date);
    if (duplicate) {
      if (!silent) new Notice(`${file.basename} is already on the calendar for ${friendlyDate(date)}`);
      return duplicate;
    }

    const viewing = {
      id: createId(),
      filePath: file.path,
      date,
      arrivalDate: normaliseDate(data.arrivalDate),
      source: normaliseSource(data.source),
      watched: false
    };
    this.viewings.push(viewing);
    await this.saveState();
    this.refreshViews();
    if (!silent) new Notice(`${displayTitle(file, this.app)} added to ${friendlyDate(date)}`);
    return viewing;
  }

  async removeViewing(id) {
    const viewing = this.viewings.find(item => item.id === id);
    if (!viewing) return;
    const title = displayTitle(this.app.vault.getAbstractFileByPath(viewing.filePath), this.app);
    this.viewings = this.viewings.filter(item => item.id !== id);
    await this.saveState();
    await this.updateWatchProperties(viewing.filePath);
    this.refreshViews();
    new Notice(`${title} removed from the calendar; its movie note was kept`);
  }

  async toggleViewing(id) {
    const viewing = this.viewings.find(item => item.id === id);
    if (!viewing) return;
    viewing.watched = !viewing.watched;
    await this.saveState();
    await this.updateWatchProperties(viewing.filePath);
    this.refreshViews();
    const title = displayTitle(this.app.vault.getAbstractFileByPath(viewing.filePath), this.app);
    new Notice(viewing.watched ? `${title} marked watched` : `${title} returned to the watchlist`);
  }

  async updateWatchProperties(filePath) {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) return;
    const watchedDates = this.viewings
      .filter(viewing => viewing.filePath === filePath && viewing.watched)
      .map(viewing => viewing.date)
      .filter(Boolean)
      .sort();
    const latest = watchedDates.at(-1) || '';
    await this.app.fileManager.processFrontMatter(file, frontmatter => {
      frontmatter.last_watched = latest;
      frontmatter.watched = watchedDates.length > 0;
    });
  }

  async moveViewing(id, newDate) {
    const viewing = this.viewings.find(item => item.id === id);
    const date = normaliseDate(newDate);
    if (!viewing || !date || viewing.date === date) return false;

    const duplicate = this.viewings.some(item =>
      item.id !== id && item.filePath === viewing.filePath && item.date === date
    );
    const title = displayTitle(this.app.vault.getAbstractFileByPath(viewing.filePath), this.app);
    if (duplicate) {
      new Notice(`${title} is already on the calendar for ${friendlyDate(date)}`);
      return false;
    }

    viewing.date = date;
    await this.saveState();
    if (viewing.watched) await this.updateWatchProperties(viewing.filePath);
    this.refreshViews();
    new Notice(`${title} moved to ${friendlyDate(date)}`);
    return true;
  }

  async createMovieFromTemplate(title, cover = '', tmdbMovie = null) {
    const folder = cleanPath(this.settings.movieFolder);
    if (!folder) throw new Error('Choose a movie notes folder first');
    await ensureFolder(this.app, folder);
    const existingBeforeLookup = this.findMatchingMovie(tmdbMovie?.title || title) || this.findMatchingMovie(title);
    if (existingBeforeLookup) return existingBeforeLookup.file;

    const tmdbMetadata = tmdbMovie ? await this.getTmdbMetadata(tmdbMovie.id) : null;
    const canonicalTitle = tmdbMetadata?.title || tmdbMovie?.title || title;
    const existingAfterLookup = this.findMatchingMovie(canonicalTitle);
    if (existingAfterLookup) return existingAfterLookup.file;

    const templateFile = this.app.vault.getAbstractFileByPath(cleanPath(this.settings.templatePath));
    const template = templateFile instanceof TFile ? await this.app.vault.cachedRead(templateFile) : MOVIE_TEMPLATE_FALLBACK;
    const body = template.replace(/{{\s*title\s*}}/gi, canonicalTitle);
    const path = await this.uniqueMoviePath(folder, sanitiseFilename(canonicalTitle));
    const file = await this.app.vault.create(path, body.endsWith('\n') ? body : `${body}\n`);
    await this.app.fileManager.processFrontMatter(file, frontmatter => {
      frontmatter.title = canonicalTitle;
      if (tmdbMetadata) applyTmdbMetadata(frontmatter, tmdbMetadata);
      if (cover) frontmatter.cover = cover;
    });
    return file;
  }

  async uniqueMoviePath(folder, base) {
    let suffix = 0;
    while (true) {
      const name = suffix ? `${base} ${suffix + 1}.md` : `${base}.md`;
      const path = `${folder}/${name}`;
      if (!this.app.vault.getAbstractFileByPath(path)) return path;
      suffix += 1;
    }
  }

  async migrateLegacyNotes() {
    if (this.migrationVersion >= 1) return;
    let changed = false;
    for (const file of this.app.vault.getMarkdownFiles()) {
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!frontmatter || frontmatter['reel-calendar'] !== true) continue;
      const date = normaliseDate(frontmatter['watch-date']);
      if (!date || this.viewings.some(viewing => viewing.filePath === file.path && viewing.date === date)) continue;
      this.viewings.push({
        id: createId(),
        filePath: file.path,
        date,
        arrivalDate: normaliseDate(frontmatter['arrival-date']),
        source: normaliseSource(frontmatter.source),
        watched: frontmatter.watched === true
      });
      changed = true;
    }
    this.migrationVersion = 1;
    await this.saveState();
    if (changed) new Notice('Reel Calendar migrated the existing schedule without creating duplicate notes');
  }

  async handleRename(file, oldPath) {
    if (!(file instanceof TFile)) return;
    let changed = false;
    for (const viewing of this.viewings) {
      if (viewing.filePath === oldPath) {
        viewing.filePath = file.path;
        changed = true;
      }
    }
    if (changed) await this.saveState();
    this.refreshViews();
  }

  async handleDelete(file) {
    if (!(file instanceof TFile)) return;
    const before = this.viewings.length;
    this.viewings = this.viewings.filter(viewing => viewing.filePath !== file.path);
    if (this.viewings.length !== before) await this.saveState();
    this.refreshViews();
  }
}

class ReelCalendarView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.month = startOfMonth(new Date());
    this.activeSource = 'all';
    this.renderTimer = null;
    this.draggedViewingId = null;
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return 'Reel Calendar'; }
  getIcon() { return 'calendar-days'; }
  async onOpen() { this.render(); }

  scheduleRender() {
    window.clearTimeout(this.renderTimer);
    this.renderTimer = window.setTimeout(() => this.render(), 80);
  }

  applyColourMode(root) {
    root.removeClass('rc-use-obsidian-theme');
    for (const className of MONTH_CLASSES) root.removeClass(className);
    if (this.plugin.settings.colourMode === 'obsidian') root.addClass('rc-use-obsidian-theme');
    else root.addClass(`rc-month-${this.month.getMonth() + 1}`);
  }

  render() {
    const root = this.contentEl;
    root.empty();
    root.addClass('reel-calendar-view');
    this.applyColourMode(root);

    const entries = this.plugin.getCalendarEntries();
    const monthEntries = entries.filter(entry => isSameMonth(entry.date, this.month));
    const monthArrivals = entries.filter(entry => isSameMonth(entry.arrivalDate, this.month));
    const filtered = this.activeSource === 'all' ? monthEntries : monthEntries.filter(entry => entry.source === this.activeSource);

    const header = root.createDiv({ cls: 'rc-header' });
    const titleGroup = header.createDiv({ cls: 'rc-title-group' });
    titleGroup.createDiv({ cls: 'rc-eyebrow', text: 'Your monthly watchlist' });
    titleGroup.createEl('h1', { text: monthTitle(this.month) });
    const actions = header.createDiv({ cls: 'rc-actions' });
    iconButton(actions, 'chevron-left', 'Previous month', () => { this.month = addMonths(this.month, -1); this.render(); });
    const todayButton = actions.createEl('button', { cls: 'rc-text-button', text: 'Today' });
    todayButton.addEventListener('click', () => { this.month = startOfMonth(new Date()); this.render(); });
    iconButton(actions, 'chevron-right', 'Next month', () => { this.month = addMonths(this.month, 1); this.render(); });
    const addButton = actions.createEl('button', { cls: 'rc-primary-button' });
    setIcon(addButton.createSpan(), 'plus');
    addButton.createSpan({ text: 'Add viewing' });
    addButton.addEventListener('click', () => {
      const today = new Date();
      const suggestedDate = today.getFullYear() === this.month.getFullYear() && today.getMonth() === this.month.getMonth()
        ? today
        : this.month;
      this.plugin.openViewingModal(suggestedDate);
    });

    const toolbar = root.createDiv({ cls: 'rc-toolbar' });
    const filters = toolbar.createDiv({ cls: 'rc-filters', attr: { 'aria-label': 'Filter by source' } });
    for (const source of ['all', 'physical', 'prime', 'free-streaming', 'other']) {
      const count = source === 'all' ? monthEntries.length : monthEntries.filter(entry => entry.source === source).length;
      const button = filters.createEl('button', {
        cls: `rc-filter${this.activeSource === source ? ' is-active' : ''}`,
        text: source === 'all' ? 'All' : SOURCE_LABELS[source]
      });
      button.createEl('small', { text: String(count) });
      button.addEventListener('click', () => { this.activeSource = source; this.render(); });
    }
    const watched = monthEntries.filter(entry => entry.watched).length;
    const progress = toolbar.createDiv({ cls: 'rc-progress' });
    progress.createSpan({ text: `${watched}/${monthEntries.length} viewings watched` });
    const progressTrack = progress.createDiv({ cls: 'rc-progress-track' });
    progressTrack.createDiv({ cls: 'rc-progress-fill', attr: { style: `width:${monthEntries.length ? watched / monthEntries.length * 100 : 0}%` } });

    if (!cleanPath(this.plugin.settings.movieFolder)) this.renderSetupBanner(root);

    const calendar = root.createDiv({ cls: 'rc-calendar' });
    const mondayFirst = this.plugin.settings.firstDayOfWeek === 'monday';
    const weekdayNames = mondayFirst ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    for (const name of weekdayNames) calendar.createDiv({ cls: 'rc-weekday', text: name });
    const startOffset = calendarOffset(this.month, mondayFirst);
    const totalDays = daysInMonth(this.month);
    for (let i = 0; i < startOffset; i++) calendar.createDiv({ cls: 'rc-day rc-day--padding' });

    for (let day = 1; day <= totalDays; day++) {
      const date = new Date(this.month.getFullYear(), this.month.getMonth(), day);
      const iso = localIsoDate(date);
      const dayEntries = filtered.filter(entry => entry.date === iso);
      const dayArrivals = monthArrivals.filter(entry => entry.arrivalDate === iso);
      const dayEl = calendar.createDiv({ cls: `rc-day${isToday(date) ? ' is-today' : ''}` });
      this.bindDropTarget(dayEl, iso);
      const dayHead = dayEl.createDiv({ cls: 'rc-day-head' });
      dayHead.createSpan({ cls: 'rc-day-number', text: String(day) });
      const addDay = dayHead.createEl('button', { cls: 'rc-day-add', attr: { 'aria-label': `Add viewing to ${iso}` } });
      setIcon(addDay, 'plus');
      addDay.addEventListener('click', () => this.plugin.openViewingModal(date));
      for (const entry of dayEntries) this.renderMovieCard(dayEl, entry);
      for (const entry of dayArrivals) {
        const arrival = dayEl.createDiv({ cls: 'rc-arrival' });
        setIcon(arrival.createSpan(), 'package');
        arrival.createSpan({ text: `${entry.movie.title} arrives` });
      }
    }
    const trailing = (7 - (startOffset + totalDays) % 7) % 7;
    for (let i = 0; i < trailing; i++) calendar.createDiv({ cls: 'rc-day rc-day--padding' });
  }

  renderMovieCard(parent, entry) {
    const card = parent.createDiv({
      cls: `rc-movie${entry.watched ? ' is-watched' : ''}`,
      attr: { draggable: 'true', title: 'Drag to another date to reschedule' }
    });
    card.addEventListener('dragstart', event => {
      if (event.target.closest('button')) {
        event.preventDefault();
        return;
      }
      this.draggedViewingId = entry.id;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', entry.id);
      event.dataTransfer.setData('application/x-reel-calendar-viewing', entry.id);
      card.addClass('is-dragging');
    });
    card.addEventListener('dragend', () => {
      this.draggedViewingId = null;
      card.removeClass('is-dragging');
      this.clearDropTargets();
    });
    if (entry.movie.cover) {
      const image = card.createEl('img', { cls: 'rc-poster', attr: { src: entry.movie.cover, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' } });
      image.addEventListener('error', () => image.replaceWith(createPosterFallback(entry.movie.title)));
    } else card.appendChild(createPosterFallback(entry.movie.title));

    const info = card.createDiv({ cls: 'rc-movie-info' });
    const title = info.createEl('button', { cls: 'rc-movie-title', text: entry.movie.title });
    title.addEventListener('click', () => this.app.workspace.getLeaf('tab').openFile(entry.movie.file));
    const meta = info.createDiv({ cls: `rc-source rc-source--${entry.source}` });
    meta.createSpan({ text: SOURCE_LABELS[entry.source] });
    if (entry.source === 'prime' || entry.source === 'free-streaming') meta.createEl('small', { text: 'availability unverified' });

    const controls = card.createDiv({ cls: 'rc-movie-controls' });
    const watched = controls.createEl('button', { cls: 'rc-watch-toggle', attr: { 'aria-label': entry.watched ? `Mark ${entry.movie.title} unwatched` : `Mark ${entry.movie.title} watched` } });
    setIcon(watched, entry.watched ? 'check-circle-2' : 'circle');
    watched.addEventListener('click', () => this.plugin.toggleViewing(entry.id));
    const remove = controls.createEl('button', { cls: 'rc-remove-viewing', attr: { 'aria-label': `Remove ${entry.movie.title} from this date` } });
    setIcon(remove, 'x');
    remove.addEventListener('click', () => this.plugin.removeViewing(entry.id));
  }

  bindDropTarget(dayEl, date) {
    dayEl.addEventListener('dragover', event => {
      if (!this.draggedViewingId) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      dayEl.addClass('is-drop-target');
    });
    dayEl.addEventListener('dragleave', event => {
      if (!event.relatedTarget || !dayEl.contains(event.relatedTarget)) dayEl.removeClass('is-drop-target');
    });
    dayEl.addEventListener('drop', async event => {
      event.preventDefault();
      const id = this.draggedViewingId
        || event.dataTransfer.getData('application/x-reel-calendar-viewing')
        || event.dataTransfer.getData('text/plain');
      this.draggedViewingId = null;
      this.clearDropTargets();
      if (id) await this.plugin.moveViewing(id, date);
    });
  }

  clearDropTargets() {
    this.contentEl.querySelectorAll('.rc-day.is-drop-target').forEach(day => day.removeClass('is-drop-target'));
  }

  renderSetupBanner(root) {
    const banner = root.createDiv({ cls: 'rc-setup-banner' });
    setIcon(banner.createSpan(), 'folder-cog');
    banner.createSpan({ text: 'Choose a movie notes folder before adding your first viewing.' });
    const button = banner.createEl('button', { cls: 'rc-text-button', text: 'Open settings' });
    button.addEventListener('click', () => this.plugin.openPluginSettings());
  }
}

class ViewingModal extends Modal {
  constructor(app, plugin, suggestedDate) {
    super(app);
    this.plugin = plugin;
    this.data = { selectedFile: null, tmdbMovie: null, title: '', date: localIsoDate(suggestedDate), arrivalDate: '', source: plugin.settings.defaultSource, cover: '' };
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('reel-calendar-modal');
    contentEl.createEl('h2', { text: 'Add a viewing' });
    contentEl.createEl('p', { cls: 'rc-modal-intro', text: 'Choose an existing movie note or enter a title. Exact title matches are reused automatically.' });

    const existingSetting = new Setting(contentEl).setName('Existing movie note').setDesc('No note selected');
    existingSetting.addButton(button => button.setButtonText('Choose note').onClick(() => {
      const movies = this.plugin.getMovieNotes();
      if (!movies.length) return new Notice('No Markdown notes were found in the selected movie folder');
      new MovieNoteSuggestModal(this.app, movies, movie => {
        this.data.selectedFile = movie.file;
        this.data.tmdbMovie = null;
        this.data.title = movie.title;
        existingSetting.setDesc(movie.file.path);
        this.titleComponent.setValue(movie.title);
        this.tmdbSetting?.setDesc('Existing notes are never overwritten with TMDB data.');
      }).open();
    }));
    existingSetting.addExtraButton(button => button.setIcon('rotate-ccw').setTooltip('Clear selected note').onClick(() => {
      this.data.selectedFile = null;
      existingSetting.setDesc('No note selected');
    }));

    new Setting(contentEl).setName('Movie title').setDesc('Used to find a matching note before a new one is created.').addText(text => {
      this.titleComponent = text;
      text.setPlaceholder('Dracula').onChange(value => {
        this.data.title = value.trim();
        if (this.data.tmdbMovie && normaliseTitle(this.data.tmdbMovie.title) !== normaliseTitle(value)) {
          this.data.tmdbMovie = null;
          this.updateTmdbDescription();
        }
      });
    });

    this.tmdbSetting = new Setting(contentEl).setName('TMDB match');
    this.updateTmdbDescription();
    this.tmdbSetting.addButton(button => button
      .setButtonText('Search TMDB')
      .setDisabled(!this.plugin.hasTmdbCredential())
      .onClick(async () => {
        const query = this.data.title.trim();
        if (!query) return new Notice('Enter a movie title before searching TMDB');
        button.setDisabled(true).setButtonText('Searching…');
        try {
          const movie = await this.plugin.chooseTmdbMovie(query);
          if (movie) {
            this.data.selectedFile = null;
            this.data.tmdbMovie = movie;
            this.data.title = movie.title;
            this.titleComponent.setValue(movie.title);
            existingSetting.setDesc('No note selected');
            this.updateTmdbDescription();
          }
        } catch (error) {
          console.error('Reel Calendar could not search TMDB', error);
          new Notice(error.message || 'Reel Calendar could not search TMDB');
        } finally {
          button.setDisabled(false).setButtonText('Search TMDB');
        }
      }));

    new Setting(contentEl).setName('Viewing date').addText(text => {
      text.inputEl.type = 'date';
      text.setValue(this.data.date).onChange(value => { this.data.date = value; });
    });

    new Setting(contentEl).setName('Source').addDropdown(dropdown => {
      Object.entries(SOURCE_LABELS).forEach(([value, label]) => dropdown.addOption(value, label));
      dropdown.setValue(this.data.source).onChange(value => { this.data.source = value; });
    });

    new Setting(contentEl).setName('Cover URL for a new note').setDesc('Ignored when an existing movie note is reused. Your note’s cover property supplies its poster.').addText(text => text
      .setPlaceholder('https://artworks.thetvdb.com/...jpg')
      .onChange(value => { this.data.cover = value.trim(); }));

    new Setting(contentEl).setName('Disc arrival date').setDesc('Optional; stored with this calendar entry, not in the movie note.').addText(text => {
      text.inputEl.type = 'date';
      text.onChange(value => { this.data.arrivalDate = value; });
    });

    const buttons = contentEl.createDiv({ cls: 'rc-modal-actions' });
    const cancel = buttons.createEl('button', { text: 'Cancel' });
    cancel.addEventListener('click', () => this.close());
    const save = buttons.createEl('button', { cls: 'mod-cta', text: 'Add viewing' });
    save.addEventListener('click', async () => {
      const title = this.data.title.trim();
      if (!this.data.selectedFile && !title) return new Notice('Choose a movie note or enter a title');
      if (!normaliseDate(this.data.date)) return new Notice('Choose a valid viewing date');
      try {
        const match = this.data.selectedFile ? { file: this.data.selectedFile } : this.plugin.findMatchingMovie(title);
        let tmdbMovie = this.data.tmdbMovie;
        if (!match && !tmdbMovie && this.plugin.hasTmdbCredential()) {
          tmdbMovie = await this.plugin.chooseTmdbMovie(title);
          if (tmdbMovie === undefined) return;
        }
        const file = match?.file || await this.plugin.createMovieFromTemplate(title, this.data.cover, tmdbMovie);
        await this.plugin.addViewing(file, this.data);
        this.close();
        await this.plugin.activateView();
      } catch (error) {
        console.error('Reel Calendar failed to add a viewing', error);
        new Notice(error.message || 'Reel Calendar could not add the viewing');
      }
    });
  }

  updateTmdbDescription() {
    if (!this.tmdbSetting) return;
    if (!this.plugin.hasTmdbCredential()) {
      this.tmdbSetting.setDesc('Optional. Add a TMDB credential in Reel Calendar settings to fill new movie notes automatically.');
      return;
    }
    if (!this.data.tmdbMovie) {
      this.tmdbSetting.setDesc('Optional. Choose the correct result before this plugin creates a new movie note.');
      return;
    }
    const year = String(this.data.tmdbMovie.release_date || '').slice(0, 4) || 'year unknown';
    this.tmdbSetting.setDesc(`${this.data.tmdbMovie.title} (${year}) selected`);
  }

  onClose() { this.contentEl.empty(); }
}

class MovieNoteSuggestModal extends FuzzySuggestModal {
  constructor(app, movies, onChoose) { super(app); this.movies = movies; this.onChoose = onChoose; this.setPlaceholder('Find a movie note…'); }
  getItems() { return this.movies; }
  getItemText(movie) { return movie.released ? `${movie.title} (${movie.released})` : movie.title; }
  onChooseItem(movie) { this.onChoose(movie); }
}

class TmdbMovieSuggestModal extends FuzzySuggestModal {
  constructor(app, movies, onChoose) {
    super(app);
    this.movies = movies;
    this.onChoose = onChoose;
    this.settled = false;
    this.setPlaceholder('Choose the matching TMDB movie…');
  }
  getItems() { return this.movies; }
  getItemText(movie) {
    const year = String(movie.release_date || '').slice(0, 4) || 'year unknown';
    const original = movie.original_title && movie.original_title !== movie.title ? ` — ${movie.original_title}` : '';
    return `${movie.title} (${year})${original}`;
  }
  onChooseItem(movie) {
    if (this.settled) return;
    this.settled = true;
    this.onChoose(movie);
  }
  onClose() {
    // Obsidian closes a suggestion modal immediately before it dispatches the
    // chosen item. Defer cancellation so onChooseItem can win that race.
    setTimeout(() => {
      if (this.settled) return;
      this.settled = true;
      this.onChoose(undefined);
    }, 0);
  }
}

class FolderSuggestModal extends FuzzySuggestModal {
  constructor(app, onChoose) { super(app); this.onChoose = onChoose; this.setPlaceholder('Choose a folder…'); }
  getItems() { return this.app.vault.getAllLoadedFiles().filter(file => file instanceof TFolder && file.path).sort((a, b) => a.path.localeCompare(b.path)); }
  getItemText(folder) { return folder.path; }
  onChooseItem(folder) { this.onChoose(folder); }
}

class TemplateSuggestModal extends FuzzySuggestModal {
  constructor(app, onChoose) { super(app); this.onChoose = onChoose; this.setPlaceholder('Choose a Markdown template…'); }
  getItems() { return this.app.vault.getMarkdownFiles().sort((a, b) => a.path.localeCompare(b.path)); }
  getItemText(file) { return file.path; }
  onChooseItem(file) { this.onChoose(file); }
}

class ReelCalendarSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Reel Calendar' });

    const folderSetting = new Setting(containerEl).setName('Movie notes folder').setDesc('Reel Calendar searches this folder for existing films and creates genuinely new notes here.');
    folderSetting.addText(text => {
      this.folderText = text;
      text.setPlaceholder('Media/Movies').setValue(this.plugin.settings.movieFolder).onChange(async value => {
        this.plugin.settings.movieFolder = cleanPath(value);
        await this.plugin.saveSettings();
      });
    });
    folderSetting.addButton(button => button.setButtonText('Choose').onClick(() => {
      new FolderSuggestModal(this.app, async folder => {
        this.plugin.settings.movieFolder = folder.path;
        this.folderText.setValue(folder.path);
        await this.plugin.saveSettings();
      }).open();
    }));

    const templateSetting = new Setting(containerEl).setName('Movie template').setDesc('Optional. New films use this Markdown template. When empty or missing, the supplied Movie Template property layout is used.');
    templateSetting.addText(text => {
      this.templateText = text;
      text.setPlaceholder('Templates/Movie Template.md').setValue(this.plugin.settings.templatePath).onChange(async value => {
        this.plugin.settings.templatePath = cleanPath(value);
        await this.plugin.saveSettings();
      });
    });
    templateSetting.addButton(button => button.setButtonText('Choose').onClick(() => {
      new TemplateSuggestModal(this.app, async file => {
        this.plugin.settings.templatePath = file.path;
        this.templateText.setValue(file.path);
        await this.plugin.saveSettings();
      }).open();
    }));

    new Setting(containerEl).setName('Calendar colours').setDesc('Use a seasonal palette that changes every month, or inherit the active Obsidian theme for every month.').addDropdown(dropdown => dropdown
      .addOption('monthly', 'Seasonal theme for each month')
      .addOption('obsidian', 'Current Obsidian theme colours')
      .setValue(this.plugin.settings.colourMode)
      .onChange(async value => { this.plugin.settings.colourMode = value; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName('First day of the week').addDropdown(dropdown => dropdown
      .addOption('monday', 'Monday')
      .addOption('sunday', 'Sunday')
      .setValue(this.plugin.settings.firstDayOfWeek)
      .onChange(async value => { this.plugin.settings.firstDayOfWeek = value; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName('Default source').addDropdown(dropdown => {
      Object.entries(SOURCE_LABELS).forEach(([value, label]) => dropdown.addOption(value, label));
      dropdown.setValue(this.plugin.settings.defaultSource).onChange(async value => { this.plugin.settings.defaultSource = value; await this.plugin.saveSettings(); });
    });

    containerEl.createEl('h3', { text: 'TMDB metadata' });
    containerEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'Optional. A credential lets Reel Calendar search for a movie and fill a newly created note. Existing movie notes are never overwritten.'
    });

    new Setting(containerEl).setName('Credential type').addDropdown(dropdown => dropdown
      .addOption('api-key', 'API key (v3 auth)')
      .addOption('read-token', 'API read access token')
      .setValue(this.plugin.settings.tmdbAuthType)
      .onChange(async value => {
        this.plugin.settings.tmdbAuthType = value;
        this.plugin.tmdbConfiguration = null;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName('TMDB credential')
      .setDesc('Stored locally in this plugin’s data.json. Vault sync tools may copy that file to your other devices.')
      .addText(text => {
        text.inputEl.type = 'password';
        text.setPlaceholder('Paste your TMDB credential')
          .setValue(this.plugin.settings.tmdbCredential)
          .onChange(async value => {
            this.plugin.settings.tmdbCredential = value.trim();
            this.plugin.tmdbConfiguration = null;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('TMDB language')
      .setDesc('BCP 47 language tag used for movie details, for example en-GB or en-US.')
      .addText(text => text
        .setPlaceholder('en-GB')
        .setValue(this.plugin.settings.tmdbLanguage)
        .onChange(async value => {
          this.plugin.settings.tmdbLanguage = value.trim() || 'en-GB';
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('TMDB region')
      .setDesc('Optional ISO 3166-1 country code used to refine search results, for example GB or US.')
      .addText(text => text
        .setPlaceholder('GB')
        .setValue(this.plugin.settings.tmdbRegion)
        .onChange(async value => {
          this.plugin.settings.tmdbRegion = value.trim().toUpperCase();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Connection test')
      .setDesc('Checks the saved credential without adding or changing any movie notes.')
      .addButton(button => button.setButtonText('Test connection').onClick(async () => {
        button.setDisabled(true).setButtonText('Testing…');
        try {
          await this.plugin.validateTmdbCredential();
          new Notice('TMDB connection successful');
        } catch (error) {
          console.error('Reel Calendar TMDB connection test failed', error);
          new Notice(error.message || 'TMDB connection failed');
        } finally {
          button.setDisabled(false).setButtonText('Test connection');
        }
      }));

    const attribution = containerEl.createDiv({ cls: 'rc-tmdb-attribution' });
    const tmdbLink = attribution.createEl('a', { href: TMDB_WEBSITE, attr: { 'aria-label': 'The Movie Database' } });
    tmdbLink.createEl('img', { attr: { src: TMDB_LOGO, alt: 'TMDB logo' } });
    const attributionCopy = attribution.createDiv();
    attributionCopy.createEl('strong', { text: 'The Movie Database' });
    attributionCopy.createEl('p', { text: TMDB_NOTICE });

  }
}

function iconButton(parent, icon, label, callback) {
  const button = parent.createEl('button', { cls: 'rc-icon-button', attr: { 'aria-label': label } });
  setIcon(button, icon);
  button.addEventListener('click', callback);
  return button;
}

function createPosterFallback(title) {
  const fallback = document.createElement('div');
  fallback.className = 'rc-poster rc-poster--fallback';
  fallback.textContent = title.split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase();
  return fallback;
}

async function ensureFolder(app, path) {
  let current = '';
  for (const part of cleanPath(path).split('/').filter(Boolean)) {
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) await app.vault.createFolder(current);
  }
}

function normaliseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return localIsoDate(value);
  if (typeof value !== 'string') return '';
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return '';
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(date.getTime())) return '';
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function normaliseSource(value) {
  const source = String(value || 'other').toLowerCase().trim().replace(/[ _]+/g, '-');
  if (source === 'amazon-prime' || source === 'amazon' || source === 'prime-video') return 'prime';
  if (source === 'free' || source === 'tubi') return 'free-streaming';
  return SOURCE_LABELS[source] ? source : 'other';
}

function normaliseTitle(value) { return String(value || '').trim().toLocaleLowerCase().replace(/\s+/g, ' '); }

function displayTitle(file, app) {
  if (!(file instanceof TFile)) return 'Movie';
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter || {};
  return String(frontmatter.title || file.basename);
}

function firstString(...values) { return values.find(value => typeof value === 'string' && value.trim())?.trim() || ''; }

function uniqueStrings(values) {
  return [...new Set(values.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))];
}

function uniqueNames(people) {
  return uniqueStrings(people.map(person => person?.name));
}

function applyTmdbMetadata(frontmatter, metadata) {
  const fields = ['director', 'writer', 'cast', 'production', 'studio', 'genre', 'group', 'released', 'rating', 'trailer', 'cover', 'banner', 'logo'];
  for (const field of fields) {
    const value = metadata[field];
    if (Array.isArray(value) ? value.length > 0 : value !== '' && value !== null && value !== undefined) {
      frontmatter[field] = value;
    }
  }
}

function tmdbImageUrl(configuration, filePath, type) {
  if (!filePath) return '';
  const images = configuration?.images || {};
  const base = images.secure_base_url || 'https://image.tmdb.org/t/p/';
  const candidates = type === 'poster' ? images.poster_sizes : type === 'backdrop' ? images.backdrop_sizes : images.logo_sizes;
  const preferred = type === 'backdrop' ? 'w1280' : 'w500';
  const size = Array.isArray(candidates) && candidates.includes(preferred) ? preferred : 'original';
  return `${base}${size}/${String(filePath).replace(/^\//, '')}`;
}

function localIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function friendlyDate(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(year, month - 1, day));
}

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `viewing-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function startOfMonth(date) { return new Date(date.getFullYear(), date.getMonth(), 1); }
function addMonths(date, count) { return new Date(date.getFullYear(), date.getMonth() + count, 1); }
function daysInMonth(date) { return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate(); }
function monthTitle(date) { return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(date); }
function isSameMonth(iso, month) { return Boolean(iso) && iso.slice(0, 7) === localIsoDate(month).slice(0, 7); }
function isToday(date) { return localIsoDate(date) === localIsoDate(new Date()); }
function calendarOffset(month, mondayFirst) { const sundayBased = month.getDay(); return mondayFirst ? (sundayBased + 6) % 7 : sundayBased; }
function cleanPath(path) { return String(path || '').trim().replace(/^\/+|\/+$/g, '').replace(/\\/g, '/'); }
function sanitiseFilename(title) { return title.replace(/[\\/:*?"<>|#[\]^]/g, '').trim() || 'Untitled movie'; }

module.exports = ReelCalendarPlugin;
