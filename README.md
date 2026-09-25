<div align="center">

# 🌙 Reel Calendar

**A poster-rich monthly movie planner that lives inside Obsidian.**

![Release](https://img.shields.io/badge/release-1.4.0-f97316?style=flat-square)
![Obsidian](https://img.shields.io/badge/Obsidian-1.5.0%2B-7c3aed?style=flat-square&logo=obsidian&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-vanilla-f7df1e?style=flat-square&logo=javascript&logoColor=111)
![TMDB](https://img.shields.io/badge/TMDB-optional-01b4e4?style=flat-square)

[Features](#-features) · [Installation](#-installation) · [TMDB metadata](#-automatic-metadata-with-tmdb) · [Movie template](#-template-and-posters) · [Compatibility](#-compatibility)

</div>

Reel Calendar combines a flexible calendar with your existing movie notes. A film keeps one canonical note while the plugin remembers any number of planned or completed viewings, so rewatches never create duplicate notes.

> [!NOTE]
> Version **1.4.0** adds user-defined viewing sources and matching calendar filters while retaining all four built-in source options.

## ✨ Features

| | Feature |
| --- | --- |
| 🗓️ | Monthly calendar that opens on the current date |
| 🎨 | Twelve seasonal palettes or colours inherited from your Obsidian theme |
| 🎞️ | Multiple films per day with drag-and-drop rescheduling |
| ✅ | Watched tracking with automatic `watched` and `last_watched` properties |
| 📝 | One canonical note per film, stored in the folder you choose |
| 🖼️ | Poster artwork from `cover`, with `poster` retained as a fallback |
| 🔎 | Optional TMDB search and automatic metadata for newly created notes |
| 💿 | Built-in and user-defined viewing sources with instant calendar filters |
| 📦 | Optional disc-arrival dates stored with individual calendar entries |

## 📥 Installation

1. Extract the `reel-calendar` folder into `<your vault>/.obsidian/plugins/`.
2. Replace the previous plugin files if updating.
3. In Obsidian, open **Settings → Community plugins** and enable **Reel Calendar**. If it was already enabled, reload the plugin or restart Obsidian.
4. Select the calendar icon in the left ribbon, or run **Reel Calendar: Open calendar**.

Reel Calendar opens directly to the current month and highlights today. It contains no pre-filled films or date-specific onboarding data.

## ⚙️ First-time setup

Open **Settings → Reel Calendar** and choose:

- **Movie notes folder** — existing films are found here and genuinely new film notes are created here.
- **Movie template** — select your `Movie Template.md`. If it is left empty or cannot be found, Reel Calendar uses the same property layout as the supplied template.
- **Calendar colours** — use twelve automatic seasonal palettes or inherit the active Obsidian theme in every month.
- Monday or Sunday as the first day of the week.
- Any custom viewing sources you use, such as Netflix, Max, or Apple TV+, and the default source for new entries.
- Optionally, a TMDB API credential, language, and region for automatic metadata.

Folder and template fields have searchable **Choose** buttons; their locations are not hard-coded.

## 🎬 One note per movie

When adding a viewing, Reel Calendar offers a searchable picker containing Markdown notes from the selected movie folder. You can instead type a title. Before creating anything, the plugin compares that title with both the `title` property and the filename in the selected folder.

If a match exists, the existing note is reused. The actual calendar records live in Reel Calendar's plugin data, so scheduling or recording another screening does not create another movie note.

## 🔎 Automatic metadata with TMDB

This integration is optional. In **Settings → Reel Calendar → TMDB metadata**:

1. Choose **API key (v3 auth)** for a TMDB v3 API key, or **API read access token** for a bearer token.
2. Paste the credential and choose the language and region used for searches and details.
3. Select **Test connection**.

When adding a viewing, enter a movie title and choose **Search TMDB**. Select the correct movie—its release year and original title help distinguish results. If a credential is configured and you save a new title without searching first, Reel Calendar opens the same result picker automatically.

For a genuinely new note, Reel Calendar fills the properties available in the selected movie's TMDB record:

| Property | TMDB data |
| --- | --- |
| `title` | Localised movie title |
| `director` | Directors |
| `writer` | Writing credits |
| `cast` | First 12 billed cast members |
| `production` | Producers and executive producers |
| `studio` | Production companies |
| `genre` | Genres |
| `group` | Collection name, when present |
| `released` | Release date |
| `rating` | TMDB vote average, rounded to one decimal |
| `trailer` | Official YouTube trailer when available, otherwise another YouTube trailer |
| `cover` | Poster image URL |
| `banner` | Backdrop image URL |
| `logo` | Preferred title-logo image URL |

Empty or unavailable fields retain the template's existing value. A manually supplied cover URL takes precedence over the TMDB poster. `watched` and `last_watched` are not set by TMDB; they continue to reflect completed Reel Calendar viewings.

The plugin never applies TMDB metadata to an existing note, so your hand-edited properties are preserved. The credential is stored in the plugin's local `data.json`; vault synchronisation tools may copy that file to other devices. Obtain credentials and review API terms at [The Movie Database developer site](https://developer.themoviedb.org/).

This product uses the TMDB API but is not endorsed or certified by TMDB.

Marking a viewing as watched updates these two properties in its canonical movie note:

```yaml
last_watched: 2026-10-05
watched: true
```

`last_watched` is recalculated from the film's completed calendar entries, so it always contains the latest completed viewing date. `watched` remains true while the film has at least one completed viewing and returns to false if none remain. Every other movie-note property is left untouched.

Removing an entry removes only that calendar viewing; the movie note is kept.

## ↔️ Rescheduling with drag and drop

On desktop, drag any movie card onto another day in the displayed month to reschedule it. The canonical movie note is not moved, renamed, or duplicated—only the viewing date changes. If the destination already contains the same film, Reel Calendar rejects the move rather than creating a duplicate.

If a completed viewing is moved, `last_watched` is recalculated from its new date.

## 🖼️ Template and posters

The supplied template is supported directly:

```yaml
---
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
```

Reel Calendar reads its poster from `cover`, with the older `poster` property retained as a compatibility fallback. Direct TVDB artwork URLs work:

```yaml
cover: "https://artworks.thetvdb.com/banners/v4/movie/623/posters/66051ff6153d9.jpg"
```

Remote posters require an internet connection and remain subject to the image host's availability and terms.

## 💿 Sources and arrivals

Each calendar viewing can have its own source and optional disc-arrival date. These built-in sources are always available:

- `physical`
- `prime`
- `free-streaming`
- `other`

In **Settings → Reel Calendar → Viewing sources**, add services such as Netflix, Max, Apple TV+, or any other label that suits your collection. Custom sources appear in the add-viewing menu, can be selected as the default, and receive their own calendar filter and colour. Names are matched case-insensitively, so duplicate labels cannot be created.

Removing a custom source never removes a scheduled viewing. Entries using that source are reassigned to **Other**, and the default source also falls back to **Other** when needed.

Prime, free-streaming, and custom-service entries are marked **availability unverified**. Reel Calendar records where you intend to watch a film; it does not claim that the title is currently available on any service.

## 🧩 Compatibility

Reel Calendar uses only Obsidian's public vault, metadata, view, modal, and settings APIs. Its CSS is scoped under `.reel-calendar-view` or `.reel-calendar-modal`; it does not alter Obsidian prototypes, global Markdown rendering, or another plugin's data.

This avoids known integration points with Book Search, Hearth, Pretty Properties, QuickAdd, Style Settings, Excalidraw, ABC Music Notation, and Chord Sheets. When theme-colour mode is selected, Reel Calendar uses Obsidian CSS variables, so active themes and Style Settings customisations flow through naturally.

## ⌨️ Commands

- **Reel Calendar: Open calendar**
- **Reel Calendar: Add viewing**

## 🛠️ Development

The plugin intentionally uses plain JavaScript and Obsidian's public API, so there is no build step. From the repository root:

```bash
node --check main.js
node test/reel-calendar.test.js
```

The release archive should contain these files inside a `reel-calendar` folder:

```text
reel-calendar/
├── main.js
├── manifest.json
├── styles.css
├── versions.json
└── README.md
```

---

<div align="center">

Made for movie nights, disc arrivals, seasonal marathons, and the occasional double feature.

</div>
