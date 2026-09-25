const assert = require('node:assert/strict');
const fs = require('node:fs');

class TFile {
  constructor(path, frontmatter = {}, body = '') {
    this.path = path;
    this.extension = 'md';
    this.basename = path.split('/').at(-1).replace(/\.md$/, '');
    this.frontmatter = frontmatter;
    this.body = body;
  }
}
class TFolder { constructor(path) { this.path = path; } }
class Plugin {}
class ItemView {}
class Modal {}
class FuzzySuggestModal {
  constructor(app) { this.app = app; }
  setPlaceholder() {}
  open() {
    // Match Obsidian's close-before-selection ordering.
    this.onClose?.();
    this.onChooseItem?.(this.movies[0]);
  }
}
class PluginSettingTab {}
class Setting {}
class Notice { constructor() {} }

const tmdbRequests = [];
async function requestUrl(options) {
  tmdbRequests.push(options);
  const url = new URL(options.url);
  if (url.pathname.endsWith('/authentication')) return { status: 200, json: { success: true } };
  if (url.pathname.endsWith('/search/movie')) {
    return {
      status: 200,
      json: {
        results: [{ id: 603, title: 'The Matrix', original_title: 'The Matrix', release_date: '1999-03-30' }]
      }
    };
  }
  if (url.pathname.endsWith('/configuration')) {
    return {
      status: 200,
      json: {
        images: {
          secure_base_url: 'https://image.tmdb.org/t/p/',
          poster_sizes: ['w342', 'w500', 'original'],
          backdrop_sizes: ['w780', 'w1280', 'original'],
          logo_sizes: ['w300', 'w500', 'original']
        }
      }
    };
  }
  if (url.pathname.endsWith('/movie/603')) {
    return {
      status: 200,
      json: {
        title: 'The Matrix',
        original_title: 'The Matrix',
        release_date: '1999-03-30',
        vote_average: 8.217,
        poster_path: '/matrix-poster.jpg',
        backdrop_path: '/matrix-backdrop.jpg',
        belongs_to_collection: { name: 'The Matrix Collection' },
        genres: [{ name: 'Action' }, { name: 'Science Fiction' }],
        production_companies: [{ name: 'Warner Bros. Pictures' }],
        credits: {
          cast: [
            { name: 'Carrie-Anne Moss', order: 1 },
            { name: 'Keanu Reeves', order: 0 }
          ],
          crew: [
            { name: 'Lana Wachowski', job: 'Director', department: 'Directing' },
            { name: 'Lilly Wachowski', job: 'Director', department: 'Directing' },
            { name: 'Lana Wachowski', job: 'Screenplay', department: 'Writing' },
            { name: 'Lilly Wachowski', job: 'Screenplay', department: 'Writing' },
            { name: 'Joel Silver', job: 'Producer', department: 'Production' }
          ]
        },
        videos: {
          results: [{ site: 'YouTube', type: 'Trailer', official: true, key: 'vKQi3bBA1y8' }]
        },
        images: {
          logos: [{ file_path: '/matrix-logo.png', iso_639_1: 'en', vote_average: 5.5 }]
        }
      }
    };
  }
  return { status: 404, json: { status_message: `Unexpected TMDB test request: ${url.pathname}` } };
}

const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'main.js'), 'utf8');
const loaded = { exports: {} };
new Function('require', 'module', 'exports', source)(name => {
  if (name !== 'obsidian') throw new Error(`Unexpected module: ${name}`);
  return { Plugin, ItemView, Modal, FuzzySuggestModal, PluginSettingTab, Setting, Notice, TFile, TFolder, setIcon() {}, requestUrl };
}, loaded, loaded.exports);
const ReelCalendarPlugin = loaded.exports;

const files = new Map();
const folders = new Map();
const app = {
  vault: {
    getMarkdownFiles: () => [...files.values()],
    getAbstractFileByPath: path => files.get(path) || folders.get(path) || null,
    createFolder: async path => { folders.set(path, new TFolder(path)); },
    create: async (path, body) => {
      const file = new TFile(path, {}, body);
      files.set(path, file);
      return file;
    },
    cachedRead: async file => file.body
  },
  metadataCache: { getFileCache: file => ({ frontmatter: file.frontmatter }) },
  fileManager: { processFrontMatter: async (file, callback) => callback(file.frontmatter) },
  workspace: { getLeavesOfType: () => [] }
};

(async () => {
  const plugin = new ReelCalendarPlugin();
  plugin.app = app;
  plugin.settings = {
    movieFolder: 'Media/Movies',
    templatePath: '',
    colourMode: 'monthly',
    firstDayOfWeek: 'monday',
    defaultSource: 'physical',
    tmdbCredential: '',
    tmdbAuthType: 'api-key',
    tmdbLanguage: 'en-GB',
    tmdbRegion: 'GB'
  };
  plugin.viewings = [];
  plugin.migrationVersion = 1;
  plugin.saveState = async () => {};

  const first = await plugin.createMovieFromTemplate('Dracula', 'https://example.com/dracula.jpg');
  const second = await plugin.createMovieFromTemplate('dracula');
  assert.equal(first, second, 'an exact title match must reuse the canonical note');
  assert.equal(files.size, 1, 'only one movie note should exist');
  assert.equal(first.frontmatter.cover, 'https://example.com/dracula.jpg');

  await plugin.addViewing(first, { date: '2026-10-01', source: 'physical' }, true);
  await plugin.addViewing(first, { date: '2027-02-14', source: 'prime' }, true);
  await plugin.addViewing(first, { date: '2027-02-14', source: 'prime' }, true);
  assert.equal(plugin.viewings.length, 2, 'a duplicate film/date pair should not duplicate the viewing');

  const duplicateMove = await plugin.moveViewing(plugin.viewings[0].id, '2027-02-14');
  assert.equal(duplicateMove, false, 'dragging onto an existing viewing for the same film/date must be rejected');
  assert.equal(plugin.viewings[0].date, '2026-10-01');
  const validMove = await plugin.moveViewing(plugin.viewings[0].id, '2026-10-02');
  assert.equal(validMove, true);
  assert.equal(plugin.viewings[0].date, '2026-10-02', 'a valid drag should reschedule the viewing');

  await plugin.toggleViewing(plugin.viewings[0].id);
  assert.equal(first.frontmatter.last_watched, '2026-10-02');
  assert.equal(first.frontmatter.watched, true, 'completing any viewing must mark the canonical note watched');
  await plugin.toggleViewing(plugin.viewings[1].id);
  assert.equal(first.frontmatter.last_watched, '2027-02-14', 'latest completed viewing should win');
  await plugin.toggleViewing(plugin.viewings[1].id);
  assert.equal(first.frontmatter.last_watched, '2026-10-02', 'unchecking should restore the latest remaining viewing');
  assert.equal(first.frontmatter.watched, true);

  await plugin.removeViewing(plugin.viewings[0].id);
  assert.equal(files.size, 1, 'removing a viewing must keep the canonical movie note');
  assert.equal(first.frontmatter.last_watched, '');
  assert.equal(first.frontmatter.watched, false, 'removing the last completed viewing must clear watched');

  plugin.settings.tmdbCredential = 'test-v3-key';
  const results = await plugin.searchTmdbMovies('The Matrix');
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 603);
  const chosenResult = await plugin.chooseTmdbMovie('The Matrix');
  assert.equal(chosenResult.id, 603, 'closing the picker before selection dispatch must not discard the chosen TMDB movie');
  const searchRequest = tmdbRequests.find(request => request.url.includes('/search/movie'));
  const searchUrl = new URL(searchRequest.url);
  assert.equal(searchUrl.searchParams.get('query'), 'The Matrix');
  assert.equal(searchUrl.searchParams.get('language'), 'en-GB');
  assert.equal(searchUrl.searchParams.get('region'), 'GB');
  assert.equal(searchUrl.searchParams.get('api_key'), 'test-v3-key');
  assert.equal(searchRequest.headers.Authorization, undefined);

  const matrix = await plugin.createMovieFromTemplate('The Matrix', '', results[0]);
  assert.equal(files.size, 2, 'TMDB creation should add exactly one canonical note');
  assert.deepEqual(matrix.frontmatter.director, ['Lana Wachowski', 'Lilly Wachowski']);
  assert.deepEqual(matrix.frontmatter.writer, ['Lana Wachowski', 'Lilly Wachowski']);
  assert.deepEqual(matrix.frontmatter.cast, ['Keanu Reeves', 'Carrie-Anne Moss']);
  assert.deepEqual(matrix.frontmatter.production, ['Joel Silver']);
  assert.deepEqual(matrix.frontmatter.studio, ['Warner Bros. Pictures']);
  assert.deepEqual(matrix.frontmatter.genre, ['Action', 'Science Fiction']);
  assert.equal(matrix.frontmatter.group, 'The Matrix Collection');
  assert.equal(matrix.frontmatter.released, '1999-03-30');
  assert.equal(matrix.frontmatter.rating, 8.2);
  assert.equal(matrix.frontmatter.trailer, 'https://www.youtube.com/watch?v=vKQi3bBA1y8');
  assert.equal(matrix.frontmatter.cover, 'https://image.tmdb.org/t/p/w500/matrix-poster.jpg');
  assert.equal(matrix.frontmatter.banner, 'https://image.tmdb.org/t/p/w1280/matrix-backdrop.jpg');
  assert.equal(matrix.frontmatter.logo, 'https://image.tmdb.org/t/p/w500/matrix-logo.png');
  assert.equal(matrix.frontmatter.watched, undefined, 'TMDB must not set viewing-state properties');
  assert.equal(matrix.frontmatter.last_watched, undefined, 'TMDB must not set viewing-state properties');

  const requestCount = tmdbRequests.length;
  const reusedMatrix = await plugin.createMovieFromTemplate('The Matrix', '', results[0]);
  assert.equal(reusedMatrix, matrix, 'TMDB creation must reuse an existing canonical note');
  assert.equal(tmdbRequests.length, requestCount, 'reusing an existing note must not fetch or overwrite TMDB metadata');

  plugin.settings.tmdbAuthType = 'read-token';
  plugin.settings.tmdbCredential = 'test-read-token';
  await plugin.validateTmdbCredential();
  const authRequest = tmdbRequests.at(-1);
  assert.equal(authRequest.headers.Authorization, 'Bearer test-read-token');
  assert.equal(new URL(authRequest.url).searchParams.has('api_key'), false);

  const sourcesPlugin = new ReelCalendarPlugin();
  sourcesPlugin.app = app;
  let savedState = { settings: { defaultSource: 'prime' }, viewings: [], migrationVersion: 1 };
  sourcesPlugin.loadData = async () => structuredClone(savedState);
  sourcesPlugin.saveData = async value => { savedState = structuredClone(value); };
  await sourcesPlugin.loadState();
  assert.deepEqual(sourcesPlugin.getSources().map(item => item.id), ['physical', 'prime', 'free-streaming', 'other']);
  assert.equal(sourcesPlugin.settings.defaultSource, 'prime', '1.3.1 settings should retain their default');
  const netflix = await sourcesPlugin.addCustomSource('  Netflix  ');
  const apple = await sourcesPlugin.addCustomSource('Apple TV+');
  assert.equal(netflix.label, 'Netflix');
  await assert.rejects(sourcesPlugin.addCustomSource('NETFLIX'), /already exists/);
  await assert.rejects(sourcesPlugin.addCustomSource('Physical'), /already exists/);
  await assert.rejects(sourcesPlugin.addCustomSource('   '), /Enter a name/);
  await sourcesPlugin.addViewing(first, { date: '2026-11-01', source: netflix.id }, true);
  await sourcesPlugin.addViewing(first, { date: '2026-11-02', source: apple.id }, true);
  sourcesPlugin.settings.defaultSource = netflix.id;
  await sourcesPlugin.saveSettings();
  await sourcesPlugin.loadState();
  assert.equal(sourcesPlugin.settings.defaultSource, netflix.id);
  assert.equal(sourcesPlugin.viewings[0].source, netflix.id, 'custom sources must survive a reload');
  assert.equal(sourcesPlugin.normaliseSource('netflix'), netflix.id);
  assert.equal(sourcesPlugin.getSourceLabel(apple.id), 'Apple TV+');
  const beforeRemoval = structuredClone(sourcesPlugin.viewings);
  assert.deepEqual(await sourcesPlugin.removeCustomSource(netflix.id), { removed: true, reassigned: 1 });
  assert.deepEqual(sourcesPlugin.viewings, beforeRemoval.map(item => item.source === netflix.id ? { ...item, source: 'other' } : item));
  assert.equal(sourcesPlugin.settings.defaultSource, 'other');
  await sourcesPlugin.loadState();
  assert.equal(sourcesPlugin.viewings[0].source, 'other', 'reassignment must persist');
  assert.equal(sourcesPlugin.getSources().some(item => item.id === netflix.id), false);
  assert.deepEqual(await sourcesPlugin.removeCustomSource('physical'), { removed: false, reassigned: 0 });
  sourcesPlugin.loadData = async () => ({ defaultSource: 'Amazon Prime' });
  await sourcesPlugin.loadState();
  assert.equal(sourcesPlugin.settings.defaultSource, 'prime', 'legacy flat settings must still load');
  assert.deepEqual(sourcesPlugin.settings.customSources, []);

  console.log('Canonical-note, rescheduling, watched-state, TMDB metadata, custom-source, and migration tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
